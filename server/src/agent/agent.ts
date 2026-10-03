import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type Groq from 'groq-sdk';
import { z } from 'zod';
import type {
  ActionStatus,
  ActivityPart,
  AssistantMessage,
  AssistantReply,
  Confirmation,
  ConfirmationPart,
  FileInfo,
  StreamEvent,
  UserMessage,
} from '@shared/api.ts';
import type { AppDeps } from '../app.ts';
import { loadCredentials } from '../auth/sessions.ts';
import type { Registry, ToolBinding } from '../connectors/registry.ts';
import { ConnectorError, splitResult, type ActionFile, type ConversationFiles, type Described } from '../connectors/types.ts';
import { one, type Db } from '../db/index.ts';
import { actions, conversations, messageEvents, type PendingCall, type PendingConfirmation } from '../db/schema.ts';
import { attachedFiles, attachFiles, historyMessage, modelMessages } from '../files/attachments.ts';
import { baseType } from '../files/formats.ts';
import { baseName } from '../files/names.ts';
import { conversationFiles, fileInfo, storeFile } from '../files/store.ts';
import { errorResponse, HttpError } from '../http.ts';
import { openConversation, openInterrupted, type WorkingConversation } from './conversation.ts';
import { explainGroqError, isRequestTooLarge, TURN_WAIT_MS, type ModelRequest, type Tool, type ToolMessage, type WaitBudget } from './model.ts';
import { CHANGE_MARK, systemPrompt, turnContext } from './prompt.ts';
import { titleFor } from './titles.ts';
import {
  confirmationPart,
  findConfirmation,
  messageWriter,
  newAssistantMessage,
  newUserMessage,
  NOT_CONFIRMED_IN_TIME,
  setChangeStatus,
  setMessageStatus,
  type MessageWriter,
} from './transcript.ts';
import { windowOf } from './window.ts';

const MAX_MODEL_CALLS = 8;
const MAX_RESULT_CHARS = 60_000;
/** How many of one response's lookups run at the same time. The rest wait their turn. */
const LOOKUPS_AT_ONCE = 4;

type ToolCall = Groq.Chat.ChatCompletionMessageToolCall;

/** One request from a signed-in person. */
export interface Turn {
  deps: AppDeps;
  log: FastifyBaseLogger;
  userId: string;
  sessionId: string;
  username: string;
  displayName: string;
  timeZone: string | undefined;
  /** Set when the client asked for the reply as a stream of events. */
  stream?: TurnStream | undefined;
  /** What the request cost the server so far, for its log line. Set once it holds its conversation. */
  stats?: TurnStats | undefined;
}

export interface TurnStream {
  send(event: StreamEvent): void;
  /** Aborts when the person stops the reply. */
  readonly signal: AbortSignal;
}

/** Counts for the log line one request writes when it ends: never anybody's words. */
export interface TurnStats {
  modelCalls: number;
  connectorCalls: number;
}

export interface TurnResult extends AssistantReply {
  /** The connected system stopped accepting the stored sign-in, so the caller must end the session. */
  signedOut: boolean;
}

interface Outcome {
  reply: string;
  confirmation: Confirmation | null;
  signedOut?: boolean;
}

/** What a request does once it holds the conversation. */
interface Plan {
  /** What kind of request it is, for the log. */
  kind: 'message' | 'decision' | 'retry' | 'edit';
  /** The assistant message the request writes: a new one, or the one it continues. */
  message: AssistantMessage;
  /** The person's message, when the request adds or changes one. */
  userMessage: UserMessage | null;
  work(reply: MessageWriter): Promise<Outcome>;
}

/** Handles something the person said or typed, with the ids of the files they attached to it. */
export async function sendMessage(
  turn: Turn,
  conversationId: string | undefined,
  text: string,
  attachmentIds: readonly string[] = [],
): Promise<TurnResult> {
  return withConversation(turn, conversationId, async (conv) => {
    // First: it can turn the message down, and changes nothing unless it succeeds.
    const attached = await attachFiles(turn.deps, turn.log, turn.userId, conv.id, attachmentIds);
    await recoverInterrupted(turn.deps.db, conv);
    // The person moved on without answering, so the waiting changes are dropped.
    if (conv.pending) await dropPending(turn, conv, conv.pending, 'superseded');
    const userMessage = newUserMessage(text, attached.map((file) => fileInfo(file, turn.deps.registry)));
    const message = newAssistantMessage();
    conv.transcript.push(userMessage, message);
    conv.messages.push(historyMessage(text, attached));
    return {
      kind: 'message',
      message,
      userMessage,
      work: async (reply) => {
        await countMessage(turn, conv.id, text, attached.length);
        const naming = conversationId ? undefined : nameConversation(turn, conv, text);
        try {
          return await runModel(turn, conv, reply, text);
        } finally {
          await naming;
        }
      },
    };
  });
}

/**
 * Changes the words of a message the person sent, and answers it again. Everything after it leaves the conversation:
 * the replies, the later messages, their lookups, files and confirmation cards. A confirmation still waiting is
 * cancelled first, so it can never be confirmed afterwards. The message keeps its id and files (unless `attachmentIds`
 * says otherwise) and gets the new words; then the turn runs exactly as a new message does.
 *
 * What was already done stays done: the action log, the download records and the weekly reports keep every action
 * with the words that asked for it at the time, and a change made in a connected system is not undone.
 */
export async function editMessage(
  turn: Turn,
  conversationId: string,
  messageId: string,
  text: string,
  attachmentIds: readonly string[] | undefined,
): Promise<TurnResult> {
  return withConversation(turn, conversationId, async (conv) => {
    const index = conv.transcript.findIndex((m) => m.role === 'user' && m.id === messageId);
    const edited = conv.transcript[index];
    if (index === -1 || edited?.role !== 'user') throw new HttpError(404, 'message_not_found', 'That message is no longer in this conversation.');
    // The person's messages come in the same order in what they see and in what the model is sent.
    const ordinal = conv.transcript.slice(0, index).filter((m) => m.role === 'user').length;
    const historyIndex = conv.messages.flatMap((m, i) => (m.role === 'user' ? [i] : []))[ordinal];
    if (historyIndex === undefined) throw new HttpError(409, 'message_not_editable', "This message can't be changed. Send a new one instead.");
    const history = conv.messages[historyIndex]!;

    // First: it can turn the request down, and changes nothing unless it succeeds.
    const attached = attachmentIds === undefined ? undefined : await attachFiles(turn.deps, turn.log, turn.userId, conv.id, attachmentIds);
    await recoverInterrupted(turn.deps.db, conv);
    // A confirmation waiting after this message can never be answered now: the log says why.
    if (conv.pending) await dropPending(turn, conv, conv.pending, 'edited');
    conv.transcript.splice(index + 1);
    conv.messages.splice(historyIndex + 1);

    edited.text = text;
    edited.editedAt = new Date().toISOString();
    if (attached !== undefined) edited.attachments = attached.map((file) => fileInfo(file, turn.deps.registry));
    const keptFiles = history.role === 'user' && 'attachments' in history && Array.isArray(history.attachments) ? history.attachments : [];
    const fileIds = attached === undefined ? keptFiles : attached.map((file) => file.id);
    conv.messages[historyIndex] = fileIds.length > 0 ? { role: 'user', content: text, attachments: fileIds } : { role: 'user', content: text };
    const message = newAssistantMessage();
    conv.transcript.push(message);
    return {
      kind: 'edit',
      message,
      userMessage: edited,
      work: async (reply) => {
        await countMessage(turn, conv.id, text, fileIds.length);
        return runModel(turn, conv, reply, text);
      },
    };
  });
}

/**
 * Runs or drops the changes waiting for confirmation. Only the calls stored when they were proposed can run.
 * The decision continues the assistant message that proposed them.
 */
export async function decide(
  turn: Turn,
  conversationId: string,
  confirmationId: string,
  decision: 'confirm' | 'cancel',
): Promise<TurnResult> {
  return withConversation(turn, conversationId, async (conv) => {
    const pending = conv.pending;
    const shown = pending?.id === confirmationId && !pending.claimed ? findConfirmation(conv.transcript, pending.id) : undefined;
    if (!pending || !shown) throw new HttpError(409, 'confirmation_not_pending', 'That change was already handled.');

    return {
      kind: 'decision',
      message: shown.message,
      userMessage: null,
      work: async (reply) => {
        if (decision === 'confirm' && Date.parse(pending.expiresAt) > Date.now()) return confirm(turn, conv, reply, pending, shown.part);
        const why = decision === 'cancel' ? 'cancelled' : 'expired';
        await dropPending(turn, conv, pending, why);
        reply.put(shown.part);
        return {
          reply:
            why === 'cancelled'
              ? "Okay, I didn't change anything."
              : "That request expired, so I didn't change anything. Ask me again if you still want it.",
          confirmation: null,
        };
      },
    };
  });
}

/** Continues a reply that failed or was stopped, from the saved history, in the same assistant message. */
export async function retry(turn: Turn, conversationId: string): Promise<TurnResult> {
  return withConversation(turn, conversationId, async (conv) => {
    await recoverInterrupted(turn.deps.db, conv);
    // Answering the confirmation is what continues it. Its tool calls stay last in the history until then.
    if (conv.pending) throw new HttpError(409, 'nothing_to_retry', 'That reply is waiting for you to confirm or cancel.');
    const index = conv.transcript.findLastIndex((m) => m.role === 'assistant');
    const message = conv.transcript[index];
    const request = conv.transcript.slice(0, index).findLast((m) => m.role === 'user');
    if (message?.role !== 'assistant' || (message.status !== 'error' && message.status !== 'stopped') || !request) {
      throw new HttpError(409, 'nothing_to_retry', 'That reply has already finished.');
    }
    if (conv.messages.at(-1)?.role === 'assistant') {
      // It was stopped part-way through its answer, so the answer is written again from the start.
      conv.messages.pop();
      if (message.parts.at(-1)?.type === 'text') message.parts.pop();
    }
    return { kind: 'retry', message, userMessage: null, work: (reply) => runModel(turn, conv, reply, request.text) };
  });
}

/**
 * Settles the requests cut off when the server last stopped, such as by a crash or a forced restart, and frees
 * their conversations straight away instead of when their leases run out. Run it before the server takes requests.
 * Returns how many conversations it settled.
 */
export async function recoverAfterRestart(db: Db): Promise<number> {
  const interrupted = await openInterrupted(db);
  for (const conv of interrupted) {
    await recoverInterrupted(db, conv);
    await conv.save({ unlock: true });
  }
  return interrupted.length;
}

/** The connected system stopped accepting the person's sign-in. */
export function signInExpired(registry: Registry): HttpError {
  return new HttpError(401, 'session_expired', `Your ${registry.signIn.name} sign-in has expired. Sign in again.`);
}

/** One row per message a person sent that the assistant took on, without its text: the weekly reports count these. */
async function countMessage(turn: Turn, conversationId: string, text: string, attachments: number) {
  await turn.deps.db.insert(messageEvents).values({ userId: turn.userId, sessionId: turn.sessionId, conversationId, chars: text.length, attachments });
}

async function confirm(
  turn: Turn,
  conv: WorkingConversation,
  reply: MessageWriter,
  pending: PendingConfirmation,
  part: ConfirmationPart,
): Promise<Outcome> {
  // Claimed and saved before anything runs: if this request dies part-way, the confirmation can't be
  // answered again, and the next message reports what actually happened (see recoverInterrupted).
  pending.claimed = true;
  part.status = 'confirmed';
  reply.put(part);
  await conv.save();

  const show = (call: PendingCall, status: ActionStatus, error: string | null) => {
    setChangeStatus(part, call.actionId, status, error);
    reply.put(part);
  };
  const results = [...pending.results];
  const outcomes: string[] = [];
  let stop: 'failed' | 'signed_out' | null = null;
  // In the order they were proposed, and no further than the first that fails: a later step often needs an earlier one.
  for (const call of pending.calls) {
    if (stop) {
      const reason = 'Not done, because an earlier change in this request failed.';
      results.push(await skip(turn, call, reason));
      show(call, 'cancelled', reason);
      continue;
    }
    show(call, 'running', null);
    const run = await execute(turn, conv.id, call.toolName, call.input, call.toolCallId, call.actionId);
    show(call, run.ok ? 'succeeded' : 'failed', run.error ?? null);
    for (const file of run.files) reply.put({ type: 'file', file });
    results.push(run.result);
    outcomes.push(run.ok ? `Done: ${call.summary}.` : `Couldn't ${lowerFirst(call.summary)}: ${run.error}`);
    if (!run.ok) stop = run.signedOut ? 'signed_out' : 'failed';
  }
  conv.pending = null;
  conv.messages.push(...results);
  // Saved before asking the model to report back, so a model failure can never run these changes twice.
  await conv.save();

  if (stop === 'signed_out') return { reply: '', confirmation: null, signedOut: true };
  try {
    return await runModel(turn, conv, reply, pending.request);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    // The changes ran either way, so the person still hears how they went, and can retry the report.
    setMessageStatus(reply.message, 'error', error.message);
    return { reply: outcomes.join(' '), confirmation: null };
  }
}

async function runModel(turn: Turn, conv: WorkingConversation, reply: MessageWriter, request: string): Promise<Outcome> {
  const { deps } = turn;
  // The same bytes for every person and every turn, so Groq can reuse its work on them: see prompt.ts.
  const system = systemPrompt(deps.registry.connectors);
  const tools = toolDefinitions(deps.registry);
  const attached = await attachedFiles(deps.db, turn.userId, conv.id, conv.messages);
  const files = conversationFiles(deps, turn.userId, conv.id);
  // All the waiting for a busy model that this turn may do, across its model calls.
  const wait: WaitBudget = { leftMs: TURN_WAIT_MS };

  for (let calls = 0; calls < MAX_MODEL_CALLS; calls++) {
    reply.beginResponse();
    const { messages: history, trimmed } = windowOf(conv.messages, deps.config.historyChars);
    const context = turnContext({ displayName: turn.displayName, username: turn.username, now: new Date(), timeZone: turn.timeZone, trimmed });
    const messages = modelMessages(history, attached, deps.config.fileTextChars);
    const completion = await callModel(turn, { system, context, tools, messages }, reply, wait);
    if (!completion) return stopped(conv, reply);
    const choice = completion.choices[0];
    if (!choice || choice.finish_reason === 'length') {
      // A tool call may be cut off, so nothing runs and the partial response is dropped, its text too.
      turn.log.warn({ finishReason: choice?.finish_reason }, 'model response was incomplete');
      reply.discardResponse();
      return say(conv, reply, "Sorry, I couldn't work that out. Could you say it more simply?");
    }
    const { content, tool_calls: toolCalls = [], reasoning } = choice.message;
    // A model that doesn't stream (such as the tests' scripted one) hands over its text at the end.
    if (!reply.responseText && content) reply.text(content);
    conv.messages.push({
      role: 'assistant',
      content: content ?? '',
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      ...(reasoning ? { reasoning } : {}),
    });
    const text = content?.trim() ?? '';
    if (toolCalls.length === 0) return { reply: text, confirmation: null };

    const { results, proposed, signedOut } = await runToolCalls(turn, conv.id, toolCalls, files, request, reply);
    if (signedOut) {
      for (const call of proposed) results.push(await skip(turn, call, SIGNED_OUT));
      conv.messages.push(...results);
      return { reply: '', confirmation: null, signedOut: true };
    }
    if (proposed.length > 0) {
      // Every change the response asked for goes on one card, in order, for one answer.
      const expiresAt = new Date(Date.now() + deps.config.confirmationTtlMs).toISOString();
      conv.pending = { id: randomUUID(), expiresAt, request, results, calls: proposed };
      reply.put(confirmationPart(conv.pending));
      return {
        reply: text,
        confirmation: { id: conv.pending.id, expiresAt, changes: proposed.map(({ system, summary }) => ({ system, summary })) },
      };
    }
    conv.messages.push(...results);
  }
  return say(conv, reply, "Sorry, I couldn't finish that. Could you try it in smaller steps?");
}

const SIGNED_OUT = 'Not run: the sign-in to the connected system has expired.';

/** One tool call of a model response, as it is checked, described, and then run or proposed. */
interface Planned {
  call: ToolCall;
  binding?: ToolBinding;
  input?: unknown;
  summary?: string;
  /** Its answer for the model, once there is one. A change proposed for confirmation gets its answer when that is decided. */
  result?: ToolMessage;
}

/**
 * Runs the lookups a response asked for, together, and lines up its changes for one confirmation. Every call is
 * checked against the connector's list and schema first, and described by the connector, which may ask its system
 * what the call names. The answers come back in the order the calls were made.
 */
async function runToolCalls(
  turn: Turn,
  conversationId: string,
  toolCalls: readonly ToolCall[],
  files: ConversationFiles,
  request: string,
  reply: MessageWriter,
): Promise<{ results: ToolMessage[]; proposed: PendingCall[]; signedOut: boolean }> {
  const { deps } = turn;
  const planned: Planned[] = toolCalls.map((call) => check(deps.registry, call));
  let signedOut = false;

  // Each call's sentence, from the connector, with the input as the connector resolved it.
  const credentials = new Map<string, Promise<unknown>>();
  const credentialsOf = (connectorId: string) => {
    let loading = credentials.get(connectorId);
    if (!loading) {
      loading = loadCredentials(deps, turn.sessionId, connectorId);
      credentials.set(connectorId, loading);
    }
    return loading;
  };
  await inTurns(planned, LOOKUPS_AT_ONCE, async (item) => {
    if (!item.binding || item.result) return;
    const described = await describe(turn, item.binding, item.input, { credentials: await credentialsOf(item.binding.connector.id), files });
    if (described instanceof ConnectorError) {
      item.result = toolError(item.call.id, described.message);
      if (described.kind === 'unauthorized' && item.binding.connector.id === deps.registry.signIn.id) signedOut = true;
      return;
    }
    item.summary = described.summary;
    item.input = described.input;
  });

  const proposed: PendingCall[] = [];
  const lookups: Planned[] = [];
  for (const item of planned) {
    if (item.result || !item.binding) continue;
    if (signedOut) {
      item.result = toolError(item.call.id, SIGNED_OUT);
      continue;
    }
    const { binding, input, summary = binding.action.name } = item;
    if (binding.action.kind === 'write') {
      const actionId = await logAction(turn, conversationId, binding, input, summary, 'awaiting_confirmation', request);
      proposed.push({ toolCallId: item.call.id, toolName: binding.toolName, input, actionId, system: binding.connector.name, summary });
      continue;
    }
    lookups.push(item);
  }

  // The lookups run together, a few at a time, each shown in the reply as it runs.
  await inTurns(lookups, LOOKUPS_AT_ONCE, async (item) => {
    const binding = item.binding!;
    const summary = item.summary ?? binding.action.name;
    if (signedOut) {
      item.result = toolError(item.call.id, SIGNED_OUT);
      return;
    }
    const actionId = await logAction(turn, conversationId, binding, item.input, summary, 'running', request);
    const activity: ActivityPart = { type: 'activity', id: actionId, system: binding.connector.name, summary, kind: 'read', status: 'running', error: null };
    reply.put(activity);
    const run = await execute(turn, conversationId, binding.toolName, item.input, item.call.id, actionId);
    reply.put({ ...activity, status: run.ok ? 'succeeded' : 'failed', error: run.error ?? null });
    for (const file of run.files) reply.put({ type: 'file', file });
    item.result = run.result;
    signedOut ||= run.signedOut;
  });

  return { results: planned.flatMap((item) => (item.result ? [item.result] : [])), proposed, signedOut };
}

/** A call as the model made it, checked against the connector list and the action's schema. */
function check(registry: Registry, call: ToolCall): Planned {
  const binding = registry.find(call.function.name);
  if (!binding) return { call, result: toolError(call.id, `There is no tool called ${call.function.name}.`) };
  let args: unknown;
  try {
    args = JSON.parse(call.function.arguments || '{}');
  } catch {
    return { call, result: toolError(call.id, 'The arguments were not valid JSON.') };
  }
  const parsed = binding.action.input.safeParse(args);
  if (!parsed.success) return { call, result: toolError(call.id, `Invalid input:\n${z.prettifyError(parsed.error)}`) };
  return { call, binding, input: parsed.data };
}

/** Runs `work` on every item, at most `limit` at a time, starting them in order. */
async function inTurns<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Calls the model, writing its text into the reply as it streams. Returns nothing when the person stopped the reply. */
async function callModel(turn: Turn, request: ModelRequest, reply: MessageWriter, wait: WaitBudget): Promise<Groq.Chat.ChatCompletion | undefined> {
  const signal = turn.stream?.signal;
  if (signal?.aborted) return undefined;
  if (turn.stats) turn.stats.modelCalls++;
  // While the model is busy, the person is told how long the wait is, and when it is over.
  const onWait = (retryInMs: number | null) =>
    turn.stream?.send(retryInMs === null ? { type: 'status', status: null } : { type: 'status', status: 'waiting_for_model', retryInMs });
  try {
    const completion = await turn.deps.model(request, { signal, onText: reply.text, onWait, wait, log: turn.log });
    return signal?.aborted ? undefined : completion;
  } catch (error) {
    if (signal?.aborted) return undefined;
    // The unfinished response never reaches the history, so its text goes too: a retry writes it again.
    reply.discardResponse();
    if (isRequestTooLarge(error)) {
      // The history, with the files' text in it, is more than the model's tier takes in one request. Trying again can't help.
      turn.log.warn({ err: error }, 'the conversation is too long for the model');
      throw new HttpError(413, 'conversation_too_long', 'This conversation, with its files, has grown too long for the assistant. Start a new one, or send less at a time.');
    }
    throw explainGroqError(error, turn.log);
  }
}

/** The person stopped the reply. The text of the response being written is kept, but never a tool call from it. */
function stopped(conv: WorkingConversation, reply: MessageWriter): Outcome {
  const partial = reply.responseText;
  if (partial) conv.messages.push({ role: 'assistant', content: partial });
  setMessageStatus(reply.message, 'stopped');
  return { reply: partial, confirmation: null };
}

/** A reply the server gives itself when the model couldn't. The model sees it as its own, as the person does. */
function say(conv: WorkingConversation, reply: MessageWriter, text: string): Outcome {
  reply.beginResponse();
  reply.text(text);
  conv.messages.push({ role: 'assistant', content: text });
  return { reply: text, confirmation: null };
}

interface RunResult {
  result: ToolMessage;
  ok: boolean;
  signedOut: boolean;
  error?: string;
  /** Files the action handed the person. */
  files: FileInfo[];
}

const FILES_NOTE =
  "The person sees each file as a card with Open, Download and Share buttons. Say briefly that it is ready and what it is; don't repeat its contents or give links.";

async function execute(
  turn: Turn,
  conversationId: string,
  toolName: string,
  input: unknown,
  toolCallId: string,
  actionId: string,
): Promise<RunResult> {
  const { deps } = turn;
  const binding = deps.registry.find(toolName);
  const parsed = binding?.action.input.safeParse(input);
  if (!binding || !parsed?.success) {
    const message = 'This action is no longer available.';
    await finish(deps.db, actionId, 'failed', message);
    return { ok: false, signedOut: false, error: message, result: toolError(toolCallId, message), files: [] };
  }

  await deps.db.update(actions).set({ status: 'running' }).where(eq(actions.id, actionId));
  if (turn.stats) turn.stats.connectorCalls++;
  let output: unknown;
  try {
    const credentials = await loadCredentials(deps, turn.sessionId, binding.connector.id);
    if (credentials === undefined) throw new ConnectorError('unauthorized', `You aren't signed in to ${binding.connector.name}.`);
    output = await binding.action.run({ credentials, files: conversationFiles(deps, turn.userId, conversationId) }, parsed.data);
  } catch (error) {
    const known = error instanceof ConnectorError ? error : undefined;
    if (!known) turn.log.error({ err: error, tool: toolName }, 'connector action failed unexpectedly');
    const message = known?.message ?? `${binding.connector.name} returned an unexpected error.`;
    await finish(deps.db, actionId, 'failed', message);
    // Losing the sign-in connector's session means the person has to sign in again.
    const signedOut = known?.kind === 'unauthorized' && binding.connector.id === deps.registry.signIn.id;
    return { ok: false, signedOut, error: message, result: toolError(toolCallId, message), files: [] };
  }
  // The system did what was asked, so a failure from here on is the server's own, never the action's.
  await finish(deps.db, actionId, 'succeeded', null);

  const { result, files } = splitResult(output);
  const delivered: FileInfo[] = [];
  const handedOver: { id: string; filename: string; mimeType: string; sizeBytes: number; description?: string | undefined }[] = [];
  for (const file of files) {
    const info = await deliver(turn, conversationId, binding, actionId, file);
    delivered.push(info);
    handedOver.push({ id: info.id, filename: info.filename, mimeType: info.mimeType, sizeBytes: info.sizeBytes, description: file.description });
  }
  const json = JSON.stringify(handedOver.length > 0 ? { result: result ?? null, files: handedOver, note: FILES_NOTE } : (result ?? null));
  if (json.length <= MAX_RESULT_CHARS) return { ok: true, signedOut: false, result: toolResult(toolCallId, json), files: delivered };
  const tooLarge =
    binding.action.kind === 'write'
      ? 'The change was made, but the response was too large to include.'
      : `The result was too large to read (${json.length} characters). Ask for fewer records or narrow the search.`;
  return { ok: true, signedOut: false, result: toolError(toolCallId, tooLarge), files: delivered };
}

/** Keeps a file an action handed over in the person's conversation, for them to open, download or share. */
async function deliver(turn: Turn, conversationId: string, binding: ToolBinding, actionId: string, file: ActionFile): Promise<FileInfo> {
  const row = await storeFile(
    turn.deps,
    {
      userId: turn.userId,
      conversationId,
      origin: 'system',
      connectorId: binding.connector.id,
      actionId,
      filename: baseName(file.filename) || 'file',
      mimeType: baseType(file.mimeType) || 'application/octet-stream',
      data: file.data,
    },
    turn.log,
  );
  return fileInfo(row, turn.deps.registry);
}

async function logAction(
  turn: Turn,
  conversationId: string,
  binding: ToolBinding,
  input: unknown,
  summary: string,
  status: ActionStatus,
  request: string,
): Promise<string> {
  const row = one(
    await turn.deps.db
      .insert(actions)
      .values({
        userId: turn.userId,
        sessionId: turn.sessionId,
        conversationId,
        connectorId: binding.connector.id,
        action: binding.action.name,
        kind: binding.action.kind,
        input,
        summary,
        status,
        request,
      })
      .returning({ id: actions.id }),
  );
  return row.id;
}

async function finish(db: Db, actionId: string, status: ActionStatus, error: string | null) {
  await db.update(actions).set({ status, error, finishedAt: new Date() }).where(eq(actions.id, actionId));
}

async function skip(turn: Turn, call: PendingCall, reason: string): Promise<ToolMessage> {
  await finish(turn.deps.db, call.actionId, 'cancelled', reason);
  return toolError(call.toolCallId, reason);
}

const DROPPED = {
  cancelled: 'The person cancelled this change, so it was not made.',
  expired: NOT_CONFIRMED_IN_TIME,
  superseded: 'The person moved on without confirming, so this change was not made.',
  edited: 'The person changed their message, so this change was not made.',
};

/** Drops the changes waiting for confirmation: nothing runs, and both the model and the card show why. */
async function dropPending(turn: Turn, conv: WorkingConversation, pending: PendingConfirmation, why: keyof typeof DROPPED) {
  const results = [...pending.results];
  for (const call of pending.calls) results.push(await skip(turn, call, DROPPED[why]));
  // The card changes only once the log has them all, so a failure part-way leaves it open to answer again.
  const part = findConfirmation(conv.transcript, pending.id)?.part;
  if (part) {
    part.status = why === 'expired' ? 'expired' : 'cancelled';
    for (const call of pending.calls) setChangeStatus(part, call.actionId, 'cancelled', DROPPED[why]);
  }
  conv.messages.push(...results);
  conv.pending = null;
}

// What an interrupted confirmed run left unfinished. Changes run one at a time, each marked running just
// before it is made, so one still awaiting confirmation was never started.
const UNFINISHED: Partial<Record<ActionStatus, { status: ActionStatus; error: string }>> = {
  awaiting_confirmation: { status: 'cancelled', error: 'The run was interrupted before this change started, so it was not made.' },
  running: {
    status: 'failed',
    error: 'The run was interrupted, so it is not known whether this change was made. Check the system before trying again.',
  },
};

/** Tidies up after a request that died part-way, such as in a restart, before the conversation is used again. */
async function recoverInterrupted(db: Db, conv: WorkingConversation) {
  const pending = conv.pending;
  for (const message of conv.transcript) {
    if (message.role !== 'assistant' || message.status !== 'streaming') continue;
    // A decision that died before it took effect: the message is as it was, with its confirmation still open.
    const undecided = pending && !pending.claimed && message.parts.some((part) => part.type === 'confirmation' && part.id === pending.id);
    if (undecided) setMessageStatus(message, 'complete');
    else setMessageStatus(message, 'error', 'This reply was interrupted. Try again.');
  }
  if (!pending?.claimed) return;

  // A confirmed run was interrupted. Report what actually happened, from the action log.
  const part = findConfirmation(conv.transcript, pending.id)?.part;
  const results = [...pending.results];
  for (const call of pending.calls) {
    const [row] = await db.select().from(actions).where(eq(actions.id, call.actionId));
    let status: ActionStatus = row?.status ?? 'running';
    let error = row?.error ?? null;
    const unfinished = UNFINISHED[status];
    if (unfinished) {
      ({ status, error } = unfinished);
      await finish(db, call.actionId, status, error);
    }
    results.push(
      status === 'succeeded' ? toolResult(call.toolCallId, 'This change was made.') : toolError(call.toolCallId, error ?? 'This change was not made.'),
    );
    if (part) setChangeStatus(part, call.actionId, status, error);
  }
  conv.messages.push(...results);
  conv.pending = null;
}

/** Names a new conversation while its first reply is written. A failure here never fails the reply. */
async function nameConversation(turn: Turn, conv: WorkingConversation, firstMessage: string) {
  const title = await titleFor(turn.deps.titler, firstMessage, turn.log);
  try {
    await turn.deps.db.update(conversations).set({ title }).where(eq(conversations.id, conv.id));
  } catch (error) {
    turn.log.error({ err: error }, 'could not save the conversation title');
    return;
  }
  conv.title = title;
  turn.stream?.send({ type: 'title', title });
}

async function withConversation(
  turn: Turn,
  conversationId: string | undefined,
  plan: (conv: WorkingConversation) => Promise<Plan>,
): Promise<TurnResult> {
  const started = performance.now();
  const stats: TurnStats = turn.stats ?? { modelCalls: 0, connectorCalls: 0 };
  turn.stats = stats;
  const conv = await openConversation(turn.deps.db, turn, conversationId);
  let prepared: Plan;
  try {
    prepared = await plan(conv);
  } catch (error) {
    // Nothing has started yet, so the conversation stays as it was: an existing one is let go, a new one removed.
    await (conversationId ? conv.release() : conv.discard());
    throw error;
  }
  const { kind, message, userMessage, work } = prepared;
  // One line per request: what kind, what it cost the server, and how it ended. Names and numbers only.
  const logTurn = (status: string) =>
    turn.log.info({ turn: kind, conversationId: conv.id, ...stats, ms: Math.round(performance.now() - started), status }, 'turn');

  let outcome: Outcome;
  try {
    setMessageStatus(message, 'streaming');
    // Saved straight away, so the history shows the request while it is answered.
    await conv.save();
    turn.stream?.send({ type: 'start', conversationId: conv.id, title: conv.title, userMessage, message });
    outcome = await work(messageWriter(message, (event) => turn.stream?.send(event)));
  } catch (error) {
    setMessageStatus(message, 'error', errorResponse(error).body.message);
    // Tool calls whose results never came can't be sent to the model again.
    const last = conv.messages.at(-1);
    if (!conv.pending && last?.role === 'assistant' && last.tool_calls?.length) conv.messages.pop();
    await conv.save({ unlock: true });
    logTurn(errorResponse(error).body.error);
    throw error;
  }

  if (outcome.signedOut) setMessageStatus(message, 'error', signInExpired(turn.deps.registry).message);
  else if (message.status === 'streaming') setMessageStatus(message, 'complete');
  await conv.save({ unlock: true });
  logTurn(message.status);
  return {
    conversationId: conv.id,
    reply: outcome.reply,
    confirmation: outcome.confirmation,
    message,
    title: conv.title,
    signedOut: outcome.signedOut ?? false,
  };
}

const toolCache = new WeakMap<Registry, Tool[]>();

/**
 * Function definitions for the model: exactly the actions on the connector list, nothing else, always in the same
 * order and the same words, so the request's start is the same for every person and every turn (see prompt.ts).
 */
export function toolDefinitions(registry: Registry): Tool[] {
  let tools = toolCache.get(registry);
  if (!tools) {
    tools = registry.bindings.map(({ toolName, action }) => {
      const { $schema: _, ...parameters } = z.toJSONSchema(action.input, { io: 'input' });
      return {
        type: 'function',
        function: {
          name: toolName,
          description: action.kind === 'write' ? `${CHANGE_MARK} ${action.description}` : action.description,
          parameters,
        },
      };
    });
    toolCache.set(registry, tools);
  }
  return tools;
}

/**
 * The sentence shown for a call, with the input as the connector resolved it, or the ConnectorError the action
 * turned the call down with.
 */
async function describe(
  turn: Turn,
  binding: ToolBinding,
  input: unknown,
  context: { credentials: unknown; files: ConversationFiles },
): Promise<Described<unknown> | ConnectorError> {
  try {
    const said = await binding.action.describe(input, context);
    const { summary, input: resolved } = typeof said === 'string' ? { summary: said, input } : said;
    return { summary: summary.trim() || binding.action.name, input: resolved };
  } catch (error) {
    if (error instanceof ConnectorError) return error;
    turn.log.error({ err: error, tool: binding.toolName }, 'describing a call failed unexpectedly');
    return { summary: `${binding.connector.name}: ${binding.action.name}`, input };
  }
}

function toolResult(toolCallId: string, content: string): ToolMessage {
  return { role: 'tool', tool_call_id: toolCallId, content };
}

function toolError(toolCallId: string, message: string): ToolMessage {
  return { role: 'tool', tool_call_id: toolCallId, content: JSON.stringify({ error: message }) };
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

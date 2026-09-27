import { randomUUID } from 'node:crypto';
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
  StreamEvent,
  UserMessage,
} from '@shared/api.ts';
import type { AppDeps } from '../app.ts';
import { loadCredentials } from '../auth/sessions.ts';
import type { Registry, ToolBinding } from '../connectors/registry.ts';
import { ConnectorError } from '../connectors/types.ts';
import { one, type Db } from '../db/index.ts';
import { actions, conversations, messageEvents, type PendingCall, type PendingConfirmation } from '../db/schema.ts';
import { errorResponse, HttpError } from '../http.ts';
import { openConversation, openInterrupted, type WorkingConversation } from './conversation.ts';
import { explainGroqError, type ModelRequest, type Tool, type ToolMessage } from './model.ts';
import { systemPrompt } from './prompt.ts';
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

const MAX_MODEL_CALLS = 8;
const MAX_RESULT_CHARS = 60_000;

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
}

export interface TurnStream {
  send(event: StreamEvent): void;
  /** Aborts when the person stops the reply. */
  readonly signal: AbortSignal;
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
  /** The assistant message the request writes: a new one, or the one it continues. */
  message: AssistantMessage;
  /** The person's new message, when the request adds one. */
  userMessage: UserMessage | null;
  work(reply: MessageWriter): Promise<Outcome>;
}

/** Handles something the person said or typed. */
export async function sendMessage(turn: Turn, conversationId: string | undefined, text: string): Promise<TurnResult> {
  return withConversation(turn, conversationId, async (conv) => {
    await recoverInterrupted(turn.deps.db, conv);
    // The person moved on without answering, so the waiting changes are dropped.
    if (conv.pending) await dropPending(turn, conv, conv.pending, 'superseded');
    const userMessage = newUserMessage(text);
    const message = newAssistantMessage();
    conv.transcript.push(userMessage, message);
    conv.messages.push({ role: 'user', content: text });
    return {
      message,
      userMessage,
      work: async (reply) => {
        await turn.deps.db
          .insert(messageEvents)
          .values({ userId: turn.userId, sessionId: turn.sessionId, conversationId: conv.id, chars: text.length });
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
    return { message, userMessage: null, work: (reply) => runModel(turn, conv, reply, request.text) };
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
  for (const call of pending.calls) {
    if (stop) {
      const reason = 'Not done, because an earlier change in this request failed.';
      results.push(await skip(turn, call, reason));
      show(call, 'cancelled', reason);
      continue;
    }
    show(call, 'running', null);
    const run = await execute(turn, call.toolName, call.input, call.toolCallId, call.actionId);
    show(call, run.ok ? 'succeeded' : 'failed', run.error ?? null);
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
  const system = systemPrompt({
    displayName: turn.displayName,
    username: turn.username,
    connectors: deps.registry.connectors,
    now: new Date(),
    timeZone: turn.timeZone,
  });
  const tools = toolDefinitions(deps.registry);

  for (let calls = 0; calls < MAX_MODEL_CALLS; calls++) {
    reply.beginResponse();
    const completion = await callModel(turn, { system, tools, messages: conv.messages }, reply);
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

    const results: ToolMessage[] = [];
    const proposed: PendingCall[] = [];
    let signedOut = false;
    for (const call of toolCalls) {
      const binding = deps.registry.find(call.function.name);
      if (!binding) {
        results.push(toolError(call.id, `There is no tool called ${call.function.name}.`));
        continue;
      }
      let args: unknown;
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        results.push(toolError(call.id, 'The arguments were not valid JSON.'));
        continue;
      }
      const parsed = binding.action.input.safeParse(args);
      if (!parsed.success) {
        results.push(toolError(call.id, `Invalid input:\n${z.prettifyError(parsed.error)}`));
        continue;
      }
      if (signedOut) {
        results.push(toolError(call.id, SIGNED_OUT));
        continue;
      }
      const summary = describe(binding, parsed.data);
      if (binding.action.kind === 'write') {
        const actionId = await logAction(turn, conv.id, binding, parsed.data, summary, 'awaiting_confirmation', request);
        proposed.push({ toolCallId: call.id, toolName: binding.toolName, input: parsed.data, actionId, system: binding.connector.name, summary });
        continue;
      }
      const actionId = await logAction(turn, conv.id, binding, parsed.data, summary, 'running', request);
      const activity: ActivityPart = {
        type: 'activity',
        id: actionId,
        system: binding.connector.name,
        summary,
        kind: binding.action.kind,
        status: 'running',
        error: null,
      };
      reply.put(activity);
      const run = await execute(turn, binding.toolName, parsed.data, call.id, actionId);
      reply.put({ ...activity, status: run.ok ? 'succeeded' : 'failed', error: run.error ?? null });
      results.push(run.result);
      signedOut ||= run.signedOut;
    }

    if (signedOut) {
      for (const call of proposed) results.push(await skip(turn, call, SIGNED_OUT));
      conv.messages.push(...results);
      return { reply: '', confirmation: null, signedOut: true };
    }
    if (proposed.length > 0) {
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

/** Calls the model, writing its text into the reply as it streams. Returns nothing when the person stopped the reply. */
async function callModel(turn: Turn, request: ModelRequest, reply: MessageWriter): Promise<Groq.Chat.ChatCompletion | undefined> {
  const signal = turn.stream?.signal;
  if (signal?.aborted) return undefined;
  try {
    const completion = await turn.deps.model(request, { signal, onText: reply.text });
    return signal?.aborted ? undefined : completion;
  } catch (error) {
    if (signal?.aborted) return undefined;
    // The unfinished response never reaches the history, so its text goes too: a retry writes it again.
    reply.discardResponse();
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
}

async function execute(turn: Turn, toolName: string, input: unknown, toolCallId: string, actionId: string): Promise<RunResult> {
  const { deps } = turn;
  const binding = deps.registry.find(toolName);
  const parsed = binding?.action.input.safeParse(input);
  if (!binding || !parsed?.success) {
    const message = 'This action is no longer available.';
    await finish(deps.db, actionId, 'failed', message);
    return { ok: false, signedOut: false, error: message, result: toolError(toolCallId, message) };
  }

  await deps.db.update(actions).set({ status: 'running' }).where(eq(actions.id, actionId));
  try {
    const credentials = await loadCredentials(deps, turn.sessionId, binding.connector.id);
    if (credentials === undefined) throw new ConnectorError('unauthorized', `You aren't signed in to ${binding.connector.name}.`);
    const output = await binding.action.run({ credentials }, parsed.data);
    await finish(deps.db, actionId, 'succeeded', null);

    const json = JSON.stringify(output ?? null);
    if (json.length <= MAX_RESULT_CHARS) return { ok: true, signedOut: false, result: toolResult(toolCallId, json) };
    const tooLarge =
      binding.action.kind === 'write'
        ? 'The change was made, but the response was too large to include.'
        : `The result was too large to read (${json.length} characters). Ask for fewer records or narrow the search.`;
    return { ok: true, signedOut: false, result: toolError(toolCallId, tooLarge) };
  } catch (error) {
    const known = error instanceof ConnectorError ? error : undefined;
    if (!known) turn.log.error({ err: error, tool: toolName }, 'connector action failed unexpectedly');
    const message = known?.message ?? `${binding.connector.name} returned an unexpected error.`;
    await finish(deps.db, actionId, 'failed', message);
    // Losing the sign-in connector's session means the person has to sign in again.
    const signedOut = known?.kind === 'unauthorized' && binding.connector.id === deps.registry.signIn.id;
    return { ok: false, signedOut, error: message, result: toolError(toolCallId, message) };
  }
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
  const conv = await openConversation(turn.deps.db, turn, conversationId);
  let prepared: Plan;
  try {
    prepared = await plan(conv);
  } catch (error) {
    // Nothing has started yet, so the conversation stays as it was.
    await conv.release();
    throw error;
  }
  const { message, userMessage, work } = prepared;

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
    throw error;
  }

  if (outcome.signedOut) setMessageStatus(message, 'error', signInExpired(turn.deps.registry).message);
  else if (message.status === 'streaming') setMessageStatus(message, 'complete');
  await conv.save({ unlock: true });
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

/** Function definitions for the model: exactly the actions on the connector list, nothing else. */
export function toolDefinitions(registry: Registry): Tool[] {
  let tools = toolCache.get(registry);
  if (!tools) {
    tools = registry.bindings.map(({ toolName, action }) => {
      const { $schema: _, ...parameters } = z.toJSONSchema(action.input, { io: 'input' });
      return {
        type: 'function',
        function: {
          name: toolName,
          description:
            action.kind === 'write' ? `${action.description} This changes data, so the person confirms it before it runs.` : action.description,
          parameters,
        },
      };
    });
    toolCache.set(registry, tools);
  }
  return tools;
}

function describe(binding: ToolBinding, input: unknown): string {
  try {
    return binding.action.describe(input).trim() || binding.action.name;
  } catch {
    return `${binding.connector.name}: ${binding.action.name}`;
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

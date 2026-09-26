import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { ActionStatus, AssistantReply, Confirmation } from '@shared/api.ts';
import type { AppDeps } from '../app.ts';
import { loadCredentials } from '../auth/sessions.ts';
import type { Registry, ToolBinding } from '../connectors/registry.ts';
import { ConnectorError } from '../connectors/types.ts';
import { one } from '../db/index.ts';
import { actions, conversations, type PendingCall, type PendingConfirmation } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import type { ModelRequest } from './model.ts';
import { systemPrompt } from './prompt.ts';

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentParam = Anthropic.Beta.BetaContentBlockParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

const MAX_MODEL_CALLS = 8;
const MAX_RESULT_CHARS = 60_000;
const LOCK_MS = 10 * 60_000;

/** One request from a signed-in person. */
export interface Turn {
  deps: AppDeps;
  log: FastifyBaseLogger;
  userId: string;
  sessionId: string;
  username: string;
  displayName: string;
  timeZone: string | undefined;
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

interface WorkingConversation {
  id: string;
  messages: MessageParam[];
  pending: PendingConfirmation | null;
  save(): Promise<void>;
}

/** Handles something the person said or typed. */
export async function sendMessage(turn: Turn, conversationId: string | undefined, text: string): Promise<TurnResult> {
  return withConversation(turn, conversationId, async (conv) => {
    const content: ContentParam[] = [];
    if (conv.pending?.claimed) {
      // A confirmed run was interrupted (e.g. a restart). Report what actually happened.
      content.push(...(await settleInterrupted(turn, conv.pending)));
      conv.pending = null;
    } else if (conv.pending) {
      // The person moved on without answering, so the waiting changes are dropped.
      content.push(...(await dropPending(turn, conv.pending, 'superseded')));
      conv.pending = null;
    }
    content.push({ type: 'text', text });
    conv.messages.push({ role: 'user', content });
    return runModel(turn, conv, text);
  });
}

/** Runs or drops the changes waiting for confirmation. Only the calls stored when they were proposed can run. */
export async function decide(
  turn: Turn,
  conversationId: string,
  confirmationId: string,
  decision: 'confirm' | 'cancel',
): Promise<TurnResult> {
  return withConversation(turn, conversationId, async (conv) => {
    const pending = conv.pending;
    if (!pending || pending.id !== confirmationId || pending.claimed) {
      throw new HttpError(409, 'confirmation_not_pending', 'That change was already handled.');
    }

    if (decision === 'cancel' || Date.parse(pending.expiresAt) <= Date.now()) {
      const why = decision === 'cancel' ? 'cancelled' : 'expired';
      conv.pending = null;
      conv.messages.push({ role: 'user', content: await dropPending(turn, pending, why) });
      return {
        reply:
          why === 'cancelled'
            ? "Okay, I didn't change anything."
            : "That request expired, so I didn't change anything. Ask me again if you still want it.",
        confirmation: null,
      };
    }

    // Claimed and saved before anything runs: if this request dies part-way, the confirmation can't be
    // answered again, and the next message reports what actually happened (see settleInterrupted).
    pending.claimed = true;
    await conv.save();

    const results = [...pending.results];
    const outcomes: string[] = [];
    let stop: 'failed' | 'signed_out' | null = null;
    for (const call of pending.calls) {
      if (stop) {
        results.push(await skip(turn, call, 'Not done, because an earlier change in this request failed.'));
        continue;
      }
      const run = await execute(turn, call.toolName, call.input, call.toolUseId, call.actionId);
      results.push(run.result);
      outcomes.push(run.ok ? `Done: ${call.summary}.` : `Couldn't ${lowerFirst(call.summary)}: ${run.error}`);
      if (!run.ok) stop = run.signedOut ? 'signed_out' : 'failed';
    }
    conv.pending = null;
    conv.messages.push({ role: 'user', content: results });
    // Saved before asking the model to report back, so a model failure can never run these changes twice.
    await conv.save();

    if (stop === 'signed_out') return { reply: '', confirmation: null, signedOut: true };
    try {
      return await runModel(turn, conv, pending.request);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      return { reply: outcomes.join(' '), confirmation: null };
    }
  });
}

async function runModel(turn: Turn, conv: WorkingConversation, request: string): Promise<Outcome> {
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
    const message = await callModel(turn, { system, tools, messages: conv.messages });
    if (message.stop_reason === 'refusal') {
      turn.log.warn({ stopDetails: message.stop_details }, 'model declined the request');
      return { reply: "Sorry, I can't help with that request.", confirmation: null };
    }
    if (message.stop_reason === 'max_tokens') {
      // A tool input may be cut off, so nothing runs and the partial turn is dropped.
      turn.log.warn('model hit max_tokens');
      return { reply: "Sorry, I couldn't work that out. Could you say it more simply?", confirmation: null };
    }
    // A fallback block only marks where a fallback model took over; the history doesn't need it.
    const content = message.content.filter((block) => block.type !== 'fallback');
    conv.messages.push({ role: 'assistant', content });
    const text = content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join(' ')
      .trim();
    const toolUses = content.filter((block) => block.type === 'tool_use');
    if (toolUses.length === 0) return { reply: text, confirmation: null };

    const results: ToolResult[] = [];
    const proposed: PendingCall[] = [];
    let signedOut = false;
    for (const use of toolUses) {
      const binding = deps.registry.find(use.name);
      if (!binding) {
        results.push(toolError(use.id, `There is no tool called ${use.name}.`));
        continue;
      }
      const parsed = binding.action.input.safeParse(use.input);
      if (!parsed.success) {
        results.push(toolError(use.id, `Invalid input:\n${z.prettifyError(parsed.error)}`));
        continue;
      }
      if (signedOut) {
        results.push(toolError(use.id, SIGNED_OUT));
        continue;
      }
      const summary = describe(binding, parsed.data);
      if (binding.action.kind === 'write') {
        const actionId = await logAction(turn, conv.id, binding, parsed.data, summary, 'awaiting_confirmation', request);
        proposed.push({ toolUseId: use.id, toolName: use.name, input: parsed.data, actionId, system: binding.connector.name, summary });
        continue;
      }
      const actionId = await logAction(turn, conv.id, binding, parsed.data, summary, 'running', request);
      const run = await execute(turn, use.name, parsed.data, use.id, actionId);
      results.push(run.result);
      signedOut ||= run.signedOut;
    }

    if (signedOut) {
      for (const call of proposed) results.push(await skip(turn, call, SIGNED_OUT));
      conv.messages.push({ role: 'user', content: results });
      return { reply: '', confirmation: null, signedOut: true };
    }
    if (proposed.length > 0) {
      const expiresAt = new Date(Date.now() + deps.config.confirmationTtlMs).toISOString();
      conv.pending = { id: randomUUID(), expiresAt, request, results, calls: proposed };
      return {
        reply: text,
        confirmation: { id: conv.pending.id, expiresAt, changes: proposed.map(({ system, summary }) => ({ system, summary })) },
      };
    }
    conv.messages.push({ role: 'user', content: results });
  }
  return { reply: "Sorry, I couldn't finish that. Could you try it in smaller steps?", confirmation: null };
}

const SIGNED_OUT = 'Not run: the sign-in to the connected system has expired.';

async function callModel(turn: Turn, request: ModelRequest): Promise<Anthropic.Beta.BetaMessage> {
  try {
    return await turn.deps.model(request);
  } catch (error) {
    if (!(error instanceof Anthropic.AnthropicError)) throw error;
    turn.log.error({ err: error }, 'model call failed');
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new HttpError(503, 'assistant_not_configured', "The assistant isn't set up correctly. Ask an administrator to check its API key.");
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new HttpError(503, 'assistant_busy', 'The assistant is busy right now. Try again in a minute.');
    }
    throw new HttpError(503, 'assistant_unavailable', 'The assistant is unavailable right now. Try again in a moment.');
  }
}

interface RunResult {
  result: ToolResult;
  ok: boolean;
  signedOut: boolean;
  error?: string;
}

async function execute(turn: Turn, toolName: string, input: unknown, toolUseId: string, actionId: string): Promise<RunResult> {
  const { deps } = turn;
  const binding = deps.registry.find(toolName);
  const parsed = binding?.action.input.safeParse(input);
  if (!binding || !parsed?.success) {
    const message = 'This action is no longer available.';
    await finish(turn, actionId, 'failed', message);
    return { ok: false, signedOut: false, error: message, result: toolError(toolUseId, message) };
  }

  await deps.db.update(actions).set({ status: 'running' }).where(eq(actions.id, actionId));
  try {
    const credentials = await loadCredentials(deps, turn.sessionId, binding.connector.id);
    if (credentials === undefined) throw new ConnectorError('unauthorized', `You aren't signed in to ${binding.connector.name}.`);
    const output = await binding.action.run({ credentials }, parsed.data);
    await finish(turn, actionId, 'succeeded', null);

    const json = JSON.stringify(output ?? null);
    if (json.length <= MAX_RESULT_CHARS) return { ok: true, signedOut: false, result: { type: 'tool_result', tool_use_id: toolUseId, content: json } };
    const tooLarge =
      binding.action.kind === 'write'
        ? 'The change was made, but the response was too large to include.'
        : `The result was too large to read (${json.length} characters). Ask for fewer records or narrow the search.`;
    return { ok: true, signedOut: false, result: toolError(toolUseId, tooLarge) };
  } catch (error) {
    const known = error instanceof ConnectorError ? error : undefined;
    if (!known) turn.log.error({ err: error, tool: toolName }, 'connector action failed unexpectedly');
    const message = known?.message ?? `${binding.connector.name} returned an unexpected error.`;
    await finish(turn, actionId, 'failed', message);
    // Losing the sign-in connector's session means the person has to sign in again.
    const signedOut = known?.kind === 'unauthorized' && binding.connector.id === deps.registry.signIn.id;
    return { ok: false, signedOut, error: message, result: toolError(toolUseId, message) };
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

async function finish(turn: Turn, actionId: string, status: ActionStatus, error: string | null) {
  await turn.deps.db.update(actions).set({ status, error, finishedAt: new Date() }).where(eq(actions.id, actionId));
}

async function skip(turn: Turn, call: PendingCall, reason: string): Promise<ToolResult> {
  await finish(turn, call.actionId, 'cancelled', reason);
  return toolError(call.toolUseId, reason);
}

const DROPPED = {
  cancelled: 'The person cancelled this change, so it was not made.',
  expired: 'The person did not confirm in time, so this change was not made.',
  superseded: 'The person moved on without confirming, so this change was not made.',
};

async function dropPending(turn: Turn, pending: PendingConfirmation, why: keyof typeof DROPPED): Promise<ToolResult[]> {
  const results = [...pending.results];
  for (const call of pending.calls) results.push(await skip(turn, call, DROPPED[why]));
  return results;
}

/** Results for confirmed calls whose run was interrupted, taken from the action log. */
async function settleInterrupted(turn: Turn, pending: PendingConfirmation): Promise<ToolResult[]> {
  const results = [...pending.results];
  for (const call of pending.calls) {
    const [row] = await turn.deps.db.select().from(actions).where(eq(actions.id, call.actionId));
    if (row?.status === 'succeeded') {
      results.push({ type: 'tool_result', tool_use_id: call.toolUseId, content: 'This change was made.' });
    } else if (row?.status === 'failed' || row?.status === 'cancelled') {
      results.push(toolError(call.toolUseId, row.error ?? 'This change was not made.'));
    } else {
      const unknown = 'The run was interrupted, so it is not known whether this change was made. Check the system before trying again.';
      await finish(turn, call.actionId, 'failed', unknown);
      results.push(toolError(call.toolUseId, unknown));
    }
  }
  return results;
}

async function withConversation(
  turn: Turn,
  conversationId: string | undefined,
  work: (conv: WorkingConversation) => Promise<Outcome>,
): Promise<TurnResult> {
  const { db } = turn.deps;
  const row = conversationId ? await lock(turn, conversationId) : await create(turn);
  const conv: WorkingConversation = {
    id: row.id,
    messages: row.messages,
    pending: row.pending,
    save: async () => {
      await db
        .update(conversations)
        .set({ messages: conv.messages, pending: conv.pending, sessionId: turn.sessionId, updatedAt: new Date() })
        .where(eq(conversations.id, conv.id));
    },
  };

  let outcome: Outcome;
  try {
    outcome = await work(conv);
  } catch (error) {
    await db.update(conversations).set({ lockedUntil: null }).where(eq(conversations.id, conv.id));
    throw error;
  }
  await db
    .update(conversations)
    .set({ messages: conv.messages, pending: conv.pending, sessionId: turn.sessionId, updatedAt: new Date(), lockedUntil: null })
    .where(eq(conversations.id, conv.id));
  return { conversationId: conv.id, reply: outcome.reply, confirmation: outcome.confirmation, signedOut: outcome.signedOut ?? false };
}

// A lease rather than a transaction: one request at a time per conversation, without holding a
// database connection open while the model thinks.
async function lock(turn: Turn, conversationId: string) {
  const { db } = turn.deps;
  const now = new Date();
  const mine = and(eq(conversations.id, conversationId), eq(conversations.userId, turn.userId));
  const [row] = await db
    .update(conversations)
    .set({ lockedUntil: new Date(now.getTime() + LOCK_MS) })
    .where(and(mine, or(isNull(conversations.lockedUntil), lt(conversations.lockedUntil, now))))
    .returning();
  if (row) return row;
  const [exists] = await db.select({ id: conversations.id }).from(conversations).where(mine);
  if (exists) throw new HttpError(409, 'conversation_busy', "I'm still working on your last request.");
  throw new HttpError(404, 'conversation_not_found', 'That conversation has ended. Start a new one.');
}

async function create(turn: Turn) {
  return one(
    await turn.deps.db
      .insert(conversations)
      .values({ userId: turn.userId, sessionId: turn.sessionId, messages: [], lockedUntil: new Date(Date.now() + LOCK_MS) })
      .returning(),
  );
}

const toolCache = new WeakMap<Registry, Anthropic.Beta.BetaTool[]>();

/** Tool definitions for the model, in registry order so the prompt prefix stays cacheable. */
export function toolDefinitions(registry: Registry): Anthropic.Beta.BetaTool[] {
  let tools = toolCache.get(registry);
  if (!tools) {
    tools = registry.bindings.map(({ toolName, action }) => {
      const { $schema: _, ...schema } = z.toJSONSchema(action.input, { io: 'input' });
      return {
        name: toolName,
        description:
          action.kind === 'write' ? `${action.description} This changes data, so the person confirms it before it runs.` : action.description,
        input_schema: schema as Anthropic.Beta.BetaTool.InputSchema,
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

function toolError(toolUseId: string, message: string): ToolResult {
  return { type: 'tool_result', tool_use_id: toolUseId, is_error: true, content: message };
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

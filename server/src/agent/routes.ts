import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AssistantReply, Capabilities, DecisionRequest, EditMessageRequest, MessageRequest, RetryRequest } from '@shared/api.ts';
import type { AppDeps } from '../app.ts';
import { authOf, endSession, requireSession } from '../auth/sessions.ts';
import { MAX_ATTACHMENTS } from '../files/attachments.ts';
import { errorResponse, parseBody } from '../http.ts';
import { eventStream } from '../sse.ts';
import { decide, editMessage, retry, sendMessage, signInExpired, type Turn, type TurnResult, type TurnStream } from './agent.ts';
import { REPLY_LANGUAGES } from './language.ts';

const TURNS_PER_MINUTE = 20;

const Text = z.string().trim().min(1).max(4000);
const Attachments = z.array(z.uuid()).max(MAX_ATTACHMENTS, `A message can carry at most ${MAX_ATTACHMENTS} files.`);
/** The language to answer in, from the app's settings (ReplyLanguage in shared/api.ts). */
const Language = z.enum(REPLY_LANGUAGES);

const MessageBody = z.object({
  conversationId: z.uuid().optional(),
  text: Text,
  timeZone: z.string().max(100).optional(),
  stream: z.boolean().optional(),
  attachments: Attachments.optional(),
  replyLanguage: Language.optional(),
}) satisfies z.ZodType<MessageRequest>;

const EditBody = z.object({
  text: Text,
  timeZone: z.string().max(100).optional(),
  stream: z.boolean().optional(),
  attachments: Attachments.optional(),
  replyLanguage: Language.optional(),
}) satisfies z.ZodType<EditMessageRequest>;

const DecisionBody = z.object({
  confirmationId: z.uuid(),
  decision: z.enum(['confirm', 'cancel']),
  timeZone: z.string().max(100).optional(),
  stream: z.boolean().optional(),
  replyLanguage: Language.optional(),
}) satisfies z.ZodType<DecisionRequest>;

const RetryBody = z.object({
  timeZone: z.string().max(100).optional(),
  stream: z.boolean().optional(),
  replyLanguage: Language.optional(),
}) satisfies z.ZodType<RetryRequest>;

export const ConversationParams = z.object({ conversationId: z.uuid() });
const MessageParams = z.object({ conversationId: z.uuid(), messageId: z.uuid() });

export function registerAssistantRoutes(app: FastifyInstance, deps: AppDeps) {
  const session = requireSession(deps);
  // Every turn runs the model on the one shared Groq key, so each person gets one allowance for all of these
  // routes, across their devices. It is one limiter rather than route configs because the in-memory store keeps
  // a separate count for each route config, even with a shared groupId.
  const turnLimit = app.rateLimit({ max: TURNS_PER_MINUTE, timeWindow: '1 minute', keyGenerator: (request) => authOf(request).user.id });
  const runsTurn = { preHandler: [session, turnLimit] };

  app.get('/assistant/capabilities', { preHandler: session }, async (): Promise<Capabilities> => ({
    systems: deps.registry.connectors.map(({ name, description, examples = [] }) => ({ name, description, examples: [...examples] })),
  }));

  app.post('/assistant/messages', runsTurn, async (request, reply) => {
    const body = parseBody(MessageBody, request.body);
    return answer(deps, request, reply, body, (turn) => sendMessage(turn, body.conversationId, body.text, body.attachments));
  });

  app.post('/assistant/conversations/:conversationId/messages/:messageId/edit', runsTurn, async (request, reply) => {
    const { conversationId, messageId } = parseBody(MessageParams, request.params);
    const body = parseBody(EditBody, request.body);
    return answer(deps, request, reply, body, (turn) => editMessage(turn, conversationId, messageId, body.text, body.attachments));
  });

  app.post('/assistant/conversations/:conversationId/decision', runsTurn, async (request, reply) => {
    const { conversationId } = parseBody(ConversationParams, request.params);
    const body = parseBody(DecisionBody, request.body);
    return answer(deps, request, reply, body, (turn) => decide(turn, conversationId, body.confirmationId, body.decision));
  });

  app.post('/assistant/conversations/:conversationId/retry', runsTurn, async (request, reply) => {
    const { conversationId } = parseBody(ConversationParams, request.params);
    const body = parseBody(RetryBody, request.body ?? {});
    return answer(deps, request, reply, body, (turn) => retry(turn, conversationId));
  });
}

/** Runs a turn and answers with one AssistantReply as JSON, or as server-sent events when the client asked to stream. */
async function answer(
  deps: AppDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  options: TurnOptions & { stream?: boolean | undefined },
  run: (turn: Turn) => Promise<TurnResult>,
): Promise<AssistantReply | undefined> {
  if (!options.stream) return result(deps, request, await run(turnFor(deps, request, options)));

  const events = eventStream(reply);
  try {
    const finished = await run(turnFor(deps, request, options, events));
    events.send({ type: 'done', reply: await result(deps, request, finished) });
  } catch (error) {
    // The conversation lookup and checks run before the stream starts, so their errors are still plain JSON.
    if (!events.started) throw error;
    const { body, unexpected } = errorResponse(error);
    if (unexpected) request.log.error({ err: error }, 'streamed request failed');
    events.send({ type: 'error', ...body });
  } finally {
    events.end();
  }
  return undefined;
}

/** What every request that runs a turn may say about how to answer. */
interface TurnOptions {
  timeZone?: string | undefined;
  replyLanguage?: Turn['replyLanguage'];
}

function turnFor(deps: AppDeps, request: FastifyRequest, { timeZone, replyLanguage }: TurnOptions, stream?: TurnStream): Turn {
  const { user, session } = authOf(request);
  return {
    deps,
    log: request.log,
    userId: user.id,
    sessionId: session.id,
    username: user.username,
    displayName: user.displayName,
    timeZone,
    replyLanguage,
    stream,
  };
}

async function result(deps: AppDeps, request: FastifyRequest, turn: TurnResult): Promise<AssistantReply> {
  if (turn.signedOut) {
    await endSession(deps, authOf(request).session.id, 'upstream_signed_out', request.log);
    throw signInExpired(deps.registry);
  }
  return { conversationId: turn.conversationId, reply: turn.reply, confirmation: turn.confirmation, message: turn.message, title: turn.title };
}

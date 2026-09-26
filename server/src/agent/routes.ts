import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AssistantReply, DecisionRequest, MessageRequest } from '@shared/api.ts';
import type { AppDeps } from '../app.ts';
import { authOf, endSession, requireSession } from '../auth/sessions.ts';
import { HttpError, parseBody } from '../http.ts';
import { decide, sendMessage, type Turn, type TurnResult } from './agent.ts';

const MessageBody = z.object({
  conversationId: z.uuid().optional(),
  text: z.string().trim().min(1).max(4000),
  timeZone: z.string().max(100).optional(),
}) satisfies z.ZodType<MessageRequest>;

const DecisionBody = z.object({
  confirmationId: z.uuid(),
  decision: z.enum(['confirm', 'cancel']),
  timeZone: z.string().max(100).optional(),
}) satisfies z.ZodType<DecisionRequest>;

const ConversationParams = z.object({ conversationId: z.uuid() });

export function registerAssistantRoutes(app: FastifyInstance, deps: AppDeps) {
  const session = requireSession(deps);

  app.post('/assistant/messages', { preHandler: session }, async (request) => {
    const body = parseBody(MessageBody, request.body);
    const result = await sendMessage(turnFor(deps, request, body.timeZone), body.conversationId, body.text);
    return respond(deps, request, result);
  });

  app.post('/assistant/conversations/:conversationId/decision', { preHandler: session }, async (request) => {
    const { conversationId } = parseBody(ConversationParams, request.params);
    const body = parseBody(DecisionBody, request.body);
    const result = await decide(turnFor(deps, request, body.timeZone), conversationId, body.confirmationId, body.decision);
    return respond(deps, request, result);
  });
}

function turnFor(deps: AppDeps, request: FastifyRequest, timeZone: string | undefined): Turn {
  const { user, session } = authOf(request);
  return { deps, log: request.log, userId: user.id, sessionId: session.id, username: user.username, displayName: user.displayName, timeZone };
}

async function respond(deps: AppDeps, request: FastifyRequest, result: TurnResult): Promise<AssistantReply> {
  if (result.signedOut) {
    await endSession(deps, authOf(request).session.id, 'upstream_signed_out', request.log);
    throw new HttpError(401, 'session_expired', `Your ${deps.registry.signIn.name} sign-in has expired. Sign in again.`);
  }
  return { conversationId: result.conversationId, reply: result.reply, confirmation: result.confirmation };
}

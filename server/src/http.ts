import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ApiError } from '@shared/api.ts';

/** An error with a status code and a message that is safe to show the person. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export interface ErrorResponse {
  status: number;
  body: ApiError;
  /** A bug or outage rather than a bad request: log it. */
  unexpected: boolean;
}

/** How to answer for an error, with a message that is safe to show the person. */
export function errorResponse(error: unknown): ErrorResponse {
  if (error instanceof HttpError) return { status: error.status, body: { error: error.code, message: error.message }, unexpected: false };
  // Fastify and its plugins mark request problems with a statusCode.
  const status = error instanceof Error ? (error as { statusCode?: number }).statusCode : undefined;
  const known = (code: string, message: string) => ({ status: status ?? 400, body: { error: code, message }, unexpected: false });
  if (status === 413) return known('too_large', 'That is too large to send.');
  if (status === 415) return known('unsupported_media_type', "That kind of content isn't accepted here.");
  if (status === 429) return known('rate_limited', 'Too many attempts. Wait a minute and try again.');
  if (status && status >= 400 && status < 500) return known('invalid_request', (error as Error).message);
  return { status: 500, body: { error: 'internal', message: 'Something went wrong on the server.' }, unexpected: true };
}

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new HttpError(400, 'invalid_request', z.prettifyError(result.error));
  return result.data;
}

/** The caller's IP. Behind a proxy this is only right when TRUST_PROXY is set. */
export function clientIp(request: FastifyRequest): string {
  return request.ip.replace(/^::ffff:/, '');
}

export function userAgent(request: FastifyRequest): string | null {
  return request.headers['user-agent']?.slice(0, 500) ?? null;
}

/** onRequest hook for responses holding downloaded conversations or audit records, which no cache may keep. */
export async function noStore(_request: FastifyRequest, reply: FastifyReply) {
  reply.header('cache-control', 'no-store');
}

import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

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

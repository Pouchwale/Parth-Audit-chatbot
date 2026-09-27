import type { FastifyReply } from 'fastify';
import type { StreamEvent } from '@shared/api.ts';

const KEEP_ALIVE_MS = 15_000;

// Native fetch on phones can hold back the first few hundred bytes of a response; padding flushes them.
const PADDING = `:${' '.repeat(2048)}\n\n`;

const HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
};

/** A response sent as server-sent events: one `event: <type>` frame per StreamEvent. */
export interface EventStream {
  /** Aborts when the client goes away before the stream ends. */
  readonly signal: AbortSignal;
  /** Whether the stream has begun. Until then, errors can still be answered as ordinary JSON. */
  readonly started: boolean;
  /** Sends an event, starting the stream with the first one. */
  send(event: StreamEvent): void;
  end(): void;
}

export function eventStream(reply: FastifyReply): EventStream {
  const res = reply.raw;
  const disconnected = new AbortController();
  let started = false;
  let keepAlive: NodeJS.Timeout | undefined;

  // The request's own 'close' (and request.signal) fire as soon as a POST body has been read, so only the
  // response closing before it finished shows that the client went away.
  res.on('close', () => {
    clearInterval(keepAlive);
    if (!res.writableFinished) disconnected.abort();
  });

  const write = (chunk: string) => {
    if (!res.writableEnded && !res.destroyed) res.write(chunk);
  };

  const start = () => {
    started = true;
    reply.hijack();
    // A hijacked reply skips Fastify's header handling, which would drop the CORS headers set by its hooks.
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) res.setHeader(name, value);
    }
    res.writeHead(200, HEADERS);
    write(PADDING);
    keepAlive = setInterval(() => write(': keep-alive\n\n'), KEEP_ALIVE_MS);
  };

  return {
    signal: disconnected.signal,
    get started() {
      return started;
    },
    send(event) {
      if (!started) start();
      write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    },
    end() {
      clearInterval(keepAlive);
      if (started && !res.writableEnded) res.end();
    },
  };
}

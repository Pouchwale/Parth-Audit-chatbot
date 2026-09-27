export interface SseEvent {
  /** The `event:` field, or "message" when the server sent none. */
  event: string;
  /** All `data:` lines of the event, joined with "\n". */
  data: string;
}

/**
 * Incremental text/event-stream parser following the WHATWG "event stream interpretation" rules.
 * Feed it decoded text in pieces of any size; it calls `onEvent` once per complete event.
 */
class SseParser {
  private partial = '';
  private endedWithCR = false;
  private eventType = '';
  private dataLines: string[] = [];
  private readonly onEvent: (event: SseEvent) => void;

  constructor(onEvent: (event: SseEvent) => void) {
    this.onEvent = onEvent;
  }

  push(text: string): void {
    let start = 0;
    // A "\r\n" pair split across two pieces is one line break, not two.
    if (this.endedWithCR) {
      this.endedWithCR = false;
      if (text.charCodeAt(0) === 10) start = 1;
    }
    for (let i = start; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code !== 10 && code !== 13) continue;
      const line = this.partial + text.slice(start, i);
      this.partial = '';
      if (code === 13) {
        if (i + 1 === text.length) this.endedWithCR = true;
        else if (text.charCodeAt(i + 1) === 10) i++;
      }
      start = i + 1;
      this.processLine(line);
    }
    this.partial += text.slice(start);
  }

  private processLine(line: string): void {
    if (line === '') return this.dispatch();
    if (line.charCodeAt(0) === 58) return; // ":" starts a comment: padding and keep-alives
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.charCodeAt(0) === 32) value = value.slice(1);
    if (field === 'event') this.eventType = value;
    else if (field === 'data') this.dataLines.push(value);
  }

  private dispatch(): void {
    if (this.dataLines.length > 0) this.onEvent({ event: this.eventType || 'message', data: this.dataLines.join('\n') });
    this.eventType = '';
    this.dataLines = [];
  }
}

/**
 * Reads a response body as server-sent events until it ends, ignoring anything after the event `isLast`
 * accepts. Resolves with whether that event arrived: a dropped connection can end a body as if it were complete.
 *
 * Reads with getReader() rather than `for await`, which the streams polyfill on phones may not support.
 */
export async function readSse(
  body: ReadableStream<Uint8Array> | null,
  onEvent: (event: SseEvent) => void,
  isLast: (event: SseEvent) => boolean,
): Promise<boolean> {
  if (!body) throw new Error('This platform did not return a readable response body.');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let finished = false;
  const parser = new SseParser((event) => {
    if (finished) return;
    finished = isLast(event);
    onEvent(event);
  });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
  } finally {
    // Only matters when reading stopped early, e.g. on an event that couldn't be handled.
    reader.cancel().catch(() => undefined);
  }
  return finished;
}

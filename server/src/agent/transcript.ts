import { randomUUID } from 'node:crypto';
import type {
  ActionStatus,
  ActivityPart,
  AssistantMessage,
  ChatMessage,
  ConfirmationPart,
  StreamEvent,
  TextPart,
  UserMessage,
} from '@shared/api.ts';
import type { PendingConfirmation } from '../db/schema.ts';

export function newUserMessage(text: string): UserMessage {
  return { id: randomUUID(), role: 'user', text, createdAt: new Date().toISOString() };
}

export function newAssistantMessage(): AssistantMessage {
  return { id: randomUUID(), role: 'assistant', parts: [], status: 'streaming', error: null, createdAt: new Date().toISOString() };
}

export function confirmationPart(pending: PendingConfirmation): ConfirmationPart {
  return {
    type: 'confirmation',
    id: pending.id,
    expiresAt: pending.expiresAt,
    status: 'pending',
    changes: pending.calls.map((call) => ({
      id: call.actionId,
      system: call.system,
      summary: call.summary,
      status: 'awaiting_confirmation',
      error: null,
    })),
  };
}

/** The part showing a confirmation, and the assistant message that holds it. */
export function findConfirmation(transcript: ChatMessage[], id: string): { message: AssistantMessage; part: ConfirmationPart } | undefined {
  for (const message of transcript.toReversed()) {
    if (message.role !== 'assistant') continue;
    const part = message.parts.find((p) => p.type === 'confirmation' && p.id === id);
    if (part?.type === 'confirmation') return { message, part };
  }
  return undefined;
}

/** Sets an assistant message's status, with the error to show when it is 'error'. */
export function setMessageStatus(message: AssistantMessage, status: AssistantMessage['status'], error: string | null = null) {
  message.status = status;
  message.error = error;
}

/** Records a change's latest status (mirroring the action log) on the confirmation part that shows it. */
export function setChangeStatus(part: ConfirmationPart, actionId: string, status: ActionStatus, error: string | null) {
  const change = part.changes.find((c) => c.id === actionId);
  if (!change) return;
  change.status = status;
  change.error = error;
}

export interface MessageWriter {
  readonly message: AssistantMessage;
  /** Text of the current model response so far. */
  readonly responseText: string;
  /** Starts a new model response. Its text goes in a text part of its own. */
  beginResponse(): void;
  /** Adds text the model wrote. */
  text(delta: string): void;
  /** Removes the text of a response that failed part-way. */
  discardResponse(): void;
  /** Adds a part, or replaces the part with the same id. Call again after changing a part's status. */
  put(part: ActivityPart | ConfirmationPart): void;
}

/** Writes an assistant message part by part, sending each change on as it happens. */
export function messageWriter(message: AssistantMessage, send: (event: StreamEvent) => void): MessageWriter {
  let current: TextPart | undefined;
  // The client still shows a discarded text part, where the next new part goes.
  let replacing = false;
  return {
    message,
    get responseText() {
      return current?.text ?? '';
    },
    beginResponse() {
      current = undefined;
    },
    text(delta) {
      if (current) {
        current.text += delta;
        send({ type: 'delta', text: delta });
        return;
      }
      const text = delta.trimStart();
      if (!text) return;
      current = { type: 'text', text };
      const whole = replacing || message.parts.at(-1)?.type === 'text';
      replacing = false;
      message.parts.push(current);
      // A delta would be added to the previous response's text part, or to the discarded one, so this part is sent whole.
      send(whole ? { type: 'part', index: message.parts.length - 1, part: current } : { type: 'delta', text });
    },
    discardResponse() {
      if (current && message.parts.at(-1) === current) {
        message.parts.pop();
        replacing = true;
      }
      current = undefined;
    },
    put(part) {
      const found = message.parts.findIndex((p) => p.type !== 'text' && p.type === part.type && p.id === part.id);
      const index = found === -1 ? message.parts.length : found;
      message.parts[index] = part;
      send({ type: 'part', index, part });
    },
  };
}

/** The start of the latest message that says something, for the history list. */
export function previewOf(latest: (ChatMessage | null)[]): string {
  for (const message of latest) {
    const text = message?.role === 'user' ? message.text : (message?.parts.map((p) => (p.type === 'text' ? p.text : '')).join(' ') ?? '');
    // The list shows plain text, so list markers, bold and code marks go.
    const plain = text.replace(/^\s*[-*+]\s+/gm, '').replace(/\*\*|__|`/g, '');
    if (plain.trim()) return shorten(plain, 120);
  }
  return '';
}

/** Cuts text to at most `max` characters, at a word boundary where there is one, and marks the cut with "…". */
export function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  // Searching from just past the cut keeps a word that ends exactly there.
  const space = flat.lastIndexOf(' ', max - 1);
  return `${flat.slice(0, space > max / 2 ? space : max - 1).trimEnd()}…`;
}

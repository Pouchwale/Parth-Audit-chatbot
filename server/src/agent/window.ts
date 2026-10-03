// How much of a conversation the model is sent with each request. Every call carries the whole history, and the Groq
// key allows 8,000 tokens a minute in all, so a long conversation would soon make every answer wait. The turn being
// answered always goes in full; earlier turns go whole, newest first, while they fit the budget, with their lookups'
// results cut short (what they said was answered then). A tool call and its result always stay together, since a
// call without its result, or a result without its call, is a request Groq turns down.
import type { HistoryMessage } from './messages.ts';

/** How much of a tool result from an earlier turn is kept, in characters. The ids and status come first in every answer. */
export const EARLIER_RESULT_CHARS = 600;
const CUT = '…(cut short: an earlier result)';

export interface Window {
  messages: HistoryMessage[];
  /** Earlier turns were left out, so the model is told the start of the conversation is not shown. */
  trimmed: boolean;
}

/**
 * The history the model is sent: the turn being answered (from the person's latest message on) in full, and before it
 * as many whole earlier turns as fit in `chars` characters of JSON, newest first.
 */
export function windowOf(history: readonly HistoryMessage[], chars: number): Window {
  const start = history.findLastIndex((message) => message.role === 'user');
  if (start <= 0) return { messages: [...history], trimmed: false };
  const current = history.slice(start);

  // Earlier turns, newest first, each from the person's message to the one before their next.
  const earlier: HistoryMessage[][] = [];
  let end = start;
  for (let i = start - 1; i >= 0; i--) {
    if (history[i]!.role === 'user' || i === 0) {
      earlier.push(history.slice(i, end).map(compact));
      end = i;
    }
  }

  const kept: HistoryMessage[][] = [];
  let room = chars;
  let trimmed = false;
  for (const turn of earlier) {
    const size = turn.reduce((sum, message) => sum + JSON.stringify(message).length, 0);
    if (size > room) {
      trimmed = true;
      break;
    }
    room -= size;
    kept.unshift(turn);
  }
  return { messages: [...kept.flat(), ...current], trimmed };
}

/** A message of an earlier turn as the model is sent it: a long result cut short, and the model's own reasoning left out. */
function compact(message: HistoryMessage): HistoryMessage {
  if (message.role === 'tool' && typeof message.content === 'string' && message.content.length > EARLIER_RESULT_CHARS) {
    return { ...message, content: `${message.content.slice(0, EARLIER_RESULT_CHARS)}${CUT}` };
  }
  if (message.role === 'assistant' && 'reasoning' in message) {
    const { reasoning: _, ...rest } = message as HistoryMessage & { reasoning?: unknown };
    return rest as HistoryMessage;
  }
  return message;
}

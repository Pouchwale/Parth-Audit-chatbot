import type { AssistantMessage, AssistantReply, ChatMessage, ConfirmationPart, MessagePart } from '@shared/api';
import { mainLanguage, type SpeechLanguage } from './speech-voice';

// Why the server drops a waiting change when the person sends a new message instead of answering.
const MOVED_ON = 'The person moved on without confirming, so this change was not made.';

/** Adds streamed text to the last part when it is text, otherwise as a new text part. */
export function appendText(message: AssistantMessage, text: string): AssistantMessage {
  const last = message.parts.at(-1);
  const parts: MessagePart[] =
    last?.type === 'text' ? [...message.parts.slice(0, -1), { type: 'text', text: last.text + text }] : [...message.parts, { type: 'text', text }];
  return { ...message, parts };
}

/** Sets the part at `index`, appending it when `index` is the number of parts. */
export function setPart(message: AssistantMessage, index: number, part: MessagePart): AssistantMessage {
  const parts = [...message.parts];
  parts.splice(index, 1, part);
  return { ...message, parts };
}

/** What the message says, as markdown: for copying and reading aloud. */
export function messageText(message: AssistantMessage): string {
  return message.parts
    .flatMap((part) => (part.type === 'text' ? [part.text.trim()] : []))
    .filter(Boolean)
    .join('\n\n');
}

/** The confirmation the person can still answer: the one the latest reply waits on. Any earlier one has been dropped. */
export function pendingConfirmation(messages: readonly ChatMessage[]): ConfirmationPart | null {
  const latest = messages.findLast((message): message is AssistantMessage => message.role === 'assistant');
  const part = latest?.parts.findLast((candidate) => candidate.type === 'confirmation');
  return part?.type === 'confirmation' && part.status === 'pending' ? part : null;
}

/** The message as the server leaves it when a new message arrives instead of an answer: nothing in it waits any more. */
export function withoutWaiting(message: ChatMessage): ChatMessage {
  if (message.role !== 'assistant' || !message.parts.some(isWaiting)) return message;
  const parts = message.parts.map((part): MessagePart => {
    if (!isWaiting(part)) return part;
    const changes = part.changes.map((change) =>
      change.status === 'awaiting_confirmation' ? { ...change, status: 'cancelled' as const, error: MOVED_ON } : change,
    );
    return { ...part, status: 'cancelled', changes };
  });
  return { ...message, parts };
}

function isWaiting(part: MessagePart): part is ConfirmationPart {
  return part.type === 'confirmation' && part.status === 'pending';
}

/**
 * The question read out after a reply whose changes wait for confirmation, in the reply's language. The changes are
 * described in English (the connected system's words); in Gujarati or Hindi they stay in the one sentence that asks
 * about them, so the voice of that language says them too, as one person would, rather than an English voice taking
 * over in the middle.
 */
const CONFIRM_QUESTION: Record<SpeechLanguage, (changes: readonly string[]) => string> = {
  en: (changes) => `Please confirm: ${changes.join('. ')}. Say confirm or cancel.`,
  gu: (changes) => `કૃપા કરીને કન્ફર્મ કરો: ${changes.join('; ')}. હા કે ના કહો.`,
  hi: (changes) => `कृपया कन्फर्म करें: ${changes.join('; ')}। हाँ या ना कहिए।`,
};

/**
 * A finished reply as it is read aloud, ending with the question when changes wait for confirmation. The question is
 * asked in the reply's language, or when the reply has no words of its own, in `asked`: the language the person chose
 * for replies, or the one their request was written in.
 */
export function spokenReply({ reply, confirmation }: AssistantReply, asked: SpeechLanguage | null = null): string {
  if (!confirmation) return reply;
  const changes = confirmation.changes.map((change) => change.summary.replace(/[.\s]+$/, ''));
  const language = mainLanguage(reply) ?? asked ?? 'en';
  return [reply, CONFIRM_QUESTION[language](changes)].filter(Boolean).join('\n\n');
}

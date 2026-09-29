import type { Message } from './model.ts';

/**
 * A person's message as it is saved: their words and the ids of the files attached to it. The files' text is added
 * when the model is called (see files/attachments.ts), so the saved history never carries it.
 */
export interface AttachedMessage {
  role: 'user';
  content: string;
  attachments: string[];
}

/** A message in a conversation's saved history. */
export type HistoryMessage = Message | AttachedMessage;

export function isAttached(message: HistoryMessage): message is AttachedMessage {
  return message.role === 'user' && Array.isArray((message as Partial<AttachedMessage>).attachments);
}

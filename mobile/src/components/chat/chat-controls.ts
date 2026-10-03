import { createContext, useContext } from 'react';
import type { ChatState } from '@/lib/chat-session';

export type Decision = 'confirm' | 'cancel';

/**
 * What the rows of a conversation need from the screen, besides their own message. It changes when a request starts
 * or ends, a card becomes answerable, reading aloud starts or stops, or an editor opens: not with every piece of a
 * reply that streams in, so that rows whose message did not change are not drawn again.
 */
export interface ChatControls {
  /** A request is running. */
  busy: boolean;
  /** The confirmation the person can answer now, wherever it is. */
  answerableId: string | null;
  /** The answer being sent, and to which confirmation. */
  deciding: { confirmationId: string; decision: Decision } | null;
  /** The id of the reply being read aloud. */
  reading: string | null;
  /** The reply being written waits for the assistant's model. */
  waiting: ChatState['waiting'];
  /**
   * The message whose editor is open, why its last change wasn't saved (if it wasn't), whether what comes after it
   * made changes in DCRS, as of now, and whether its box takes the keyboard's focus when drawn.
   */
  editing: { id: string; error: string | null; madeChanges: boolean; focus: boolean } | null;
  /** The chat is the screen in front, with the menu closed: the phone's back button is the editor's to take. */
  inFront: boolean;
  decide(confirmationId: string, decision: Decision): void;
  /** Continues the last reply after it failed. */
  retry(): void;
  startEdit(messageId: string): void;
  cancelEdit(): void;
  saveEdit(messageId: string, text: string): void;
  /** The editor's box has the keyboard's focus. */
  editorFocused(): void;
  /** The words typed so far into a message's editor, or null when it has only just opened. */
  draftOf(messageId: string): string | null;
  /** Keeps the words being typed into a message's editor, without drawing anything. */
  keepDraft(messageId: string, text: string): void;
}

const ChatControlsContext = createContext<ChatControls | null>(null);

export const ChatControlsProvider = ChatControlsContext.Provider;

export function useChatControls(): ChatControls {
  const value = useContext(ChatControlsContext);
  if (!value) throw new Error('useChatControls must be used inside <ChatControlsProvider>');
  return value;
}

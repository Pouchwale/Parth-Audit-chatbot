import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { useAuth } from './auth';
import { ChatSession, type ChatSessionDeps, type ChatState } from './chat-session';
import { useConversations } from './conversations';

/**
 * The signed-in person's chats. A reply keeps streaming when its screen closes, so that a new chat can move
 * to its own address, and the person can look at another chat meanwhile, without losing it.
 */
class ChatSessions {
  private readonly running = new Set<ChatSession>();
  private readonly deps: ChatSessionDeps;
  /** The newest sign-in's way of calling the API and refreshing the list: sessions outlive renders, so the provider keeps this current. */
  private readonly latest: RefObject<Omit<ChatSessionDeps, 'busy'>>;

  constructor(latest: RefObject<Omit<ChatSessionDeps, 'busy'>>) {
    this.latest = latest;
    this.deps = {
      call: (request) => this.latest.current.call(request),
      changed: () => this.latest.current.changed(),
      busy: (session, busy) => {
        if (busy) this.running.add(session);
        else this.running.delete(session);
      },
    };
  }

  /** The session still writing a reply in this conversation, or a new one that loads it. No id: a new chat. */
  open(conversationId?: string): ChatSession {
    for (const session of this.running) {
      if (conversationId && session.conversationId === conversationId) return session;
    }
    return new ChatSession(this.deps, conversationId);
  }

  abandonAll(): void {
    for (const session of this.running) session.abandon();
  }
}

const ChatSessionsContext = createContext<ChatSessions | null>(null);

/** Holds the chats while the person is signed in; signing out stops any reply still being written. */
export function ChatSessionsProvider({ children }: { children: ReactNode }) {
  const { call } = useAuth();
  const { refresh } = useConversations();
  const latest = useRef({ call, changed: () => void refresh() });
  useEffect(() => {
    latest.current = { call, changed: () => void refresh() };
  }, [call, refresh]);
  const [sessions] = useState(() => new ChatSessions(latest));
  useEffect(() => () => sessions.abandonAll(), [sessions]);

  return <ChatSessionsContext.Provider value={sessions}>{children}</ChatSessionsContext.Provider>;
}

export function useChatSessions(): ChatSessions {
  const value = useContext(ChatSessionsContext);
  if (!value) throw new Error('useChatSessions must be used inside <ChatSessionsProvider>');
  return value;
}

export function useChatState(session: ChatSession): ChatState {
  return useSyncExternalStore(session.subscribe, session.getState);
}

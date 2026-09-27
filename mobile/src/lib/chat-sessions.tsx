import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
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

  constructor(deps: Omit<ChatSessionDeps, 'busy'>) {
    this.deps = {
      ...deps,
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
  // Sessions outlive renders, so they reach the newest sign-in through this.
  const latest = useRef({ call, refresh });
  useEffect(() => {
    latest.current = { call, refresh };
  }, [call, refresh]);

  const [sessions] = useState(
    () =>
      new ChatSessions({
        call: (request) => latest.current.call(request),
        changed: () => void latest.current.refresh(),
      }),
  );
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

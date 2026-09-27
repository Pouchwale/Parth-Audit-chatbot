import { router } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ConversationSummary } from '@shared/api';
import { api, ApiError, errorMessage } from './api';
import { useAuth } from './auth';

interface ConversationsValue {
  /** The signed-in person's conversations, most recently updated first; null until the first load. */
  conversations: ConversationSummary[] | null;
  /** Why the last load failed. A list loaded earlier stays available. */
  error: string | null;
  /** Reloads the list. Never throws: a failure is reported through `error`. */
  refresh(): Promise<void>;
  rename(conversationId: string, title: string): Promise<void>;
  remove(conversationId: string): Promise<void>;
  removeAll(): Promise<void>;
  /** Changes each time a new chat starts; the new-chat screen uses it as a key to start blank. */
  newChatKey: number;
  /** Opens a blank new chat. For use inside the drawer, where the new-chat screen lives. */
  startNewChat(): void;
}

interface Loaded {
  userId: string;
  conversations: ConversationSummary[] | null;
  error: string | null;
}

const ConversationsContext = createContext<ConversationsValue | null>(null);

export function ConversationsProvider({ children }: { children: ReactNode }) {
  const { call, user } = useAuth();
  const userId = user?.id ?? null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [newChatKey, setNewChatKey] = useState(0);
  // Only the newest load may land, and not after a local change it didn't see.
  const generation = useRef(0);

  // After switching accounts, never show the previous person's list, even for a frame.
  const current = loaded && loaded.userId === userId ? loaded : null;

  const refresh = useCallback(async () => {
    if (!userId) return;
    const request = ++generation.current;
    try {
      const conversations = await call((token) => api.conversations(token));
      if (request === generation.current) setLoaded({ userId, conversations, error: null });
    } catch (error) {
      if (request !== generation.current) return;
      if (error instanceof ApiError && error.status === 401) return; // Signed out: the sign-in screen says why.
      setLoaded((previous) => ({
        userId,
        conversations: previous?.userId === userId ? previous.conversations : null,
        error: errorMessage(error),
      }));
    }
  }, [call, userId]);

  const apply = useCallback(
    (change: (conversations: ConversationSummary[]) => ConversationSummary[]) => {
      if (!userId) return;
      generation.current++;
      setLoaded((previous) => ({
        userId,
        conversations: change(previous?.userId === userId ? (previous.conversations ?? []) : []),
        error: null,
      }));
    },
    [userId],
  );

  const rename = useCallback(
    async (conversationId: string, title: string) => {
      const renamed = await call((token) => api.renameConversation(token, conversationId, { title }));
      apply((conversations) => conversations.map((conversation) => (conversation.id === conversationId ? renamed : conversation)));
    },
    [call, apply],
  );

  const remove = useCallback(
    async (conversationId: string) => {
      await call((token) => api.deleteConversation(token, conversationId));
      apply((conversations) => conversations.filter((conversation) => conversation.id !== conversationId));
    },
    [call, apply],
  );

  const removeAll = useCallback(async () => {
    await call((token) => api.deleteAllConversations(token));
    apply(() => []);
    // A chat in progress on the new-chat screen was deleted too.
    setNewChatKey((key) => key + 1);
  }, [call, apply]);

  const startNewChat = useCallback(() => {
    setNewChatKey((key) => key + 1);
    router.navigate('/');
  }, []);

  const value = useMemo(
    () => ({
      conversations: current?.conversations ?? null,
      error: current?.error ?? null,
      refresh,
      rename,
      remove,
      removeAll,
      newChatKey,
      startNewChat,
    }),
    [current, refresh, rename, remove, removeAll, newChatKey, startNewChat],
  );
  return <ConversationsContext.Provider value={value}>{children}</ConversationsContext.Provider>;
}

export function useConversations(): ConversationsValue {
  const value = useContext(ConversationsContext);
  if (!value) throw new Error('useConversations must be used inside <ConversationsProvider>');
  return value;
}

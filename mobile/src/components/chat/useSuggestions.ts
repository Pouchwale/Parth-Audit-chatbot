import { useEffect, useState } from 'react';
import type { Capabilities } from '@shared/api';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export interface Suggestion {
  text: string;
  system: string;
}

export type SuggestionsState =
  | { status: 'loading' }
  | { status: 'ready'; suggestions: Suggestion[] }
  | { status: 'failed'; retry(): void };

const MAX_SUGGESTIONS = 4;

// Every new chat shows the same suggestions, so they are fetched once per signed-in person.
let saved: { userId: string; suggestions: Suggestion[] } | null = null;

/** Requests people can try, from the connected systems' examples, for the welcome screen. */
export function useSuggestions(): SuggestionsState {
  const { call, user } = useAuth();
  const userId = user?.id ?? null;
  const [loaded, setLoaded] = useState(saved);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const current = loaded && loaded.userId === userId ? loaded : null;

  useEffect(() => {
    if (!userId || current) return;
    let active = true;
    call((token) => api.capabilities(token))
      .then((capabilities) => {
        saved = { userId, suggestions: suggestionsFrom(capabilities) };
        if (active) setLoaded(saved);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [call, userId, current, attempt]);

  if (current) return { status: 'ready', suggestions: current.suggestions };
  if (failed) {
    return {
      status: 'failed',
      retry: () => {
        setFailed(false);
        setAttempt((count) => count + 1);
      },
    };
  }
  return { status: 'loading' };
}

function suggestionsFrom({ systems }: Capabilities): Suggestion[] {
  return systems.flatMap(({ name, examples }) => examples.map((text) => ({ text, system: name }))).slice(0, MAX_SUGGESTIONS);
}

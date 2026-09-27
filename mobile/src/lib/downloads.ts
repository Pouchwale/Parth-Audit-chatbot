import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExportEntry } from '@shared/api';
import { api, ApiError, errorMessage, type ExportFilters } from './api';
import { useAuth } from './auth';

export interface Downloads {
  /** Newest first, as far as loaded; null until the first page for the current filters arrives. */
  exports: ExportEntry[] | null;
  /** Why the list couldn't be loaded or refreshed. A list loaded earlier stays. */
  error: string | null;
  /** Older downloads remain to be loaded. */
  hasMore: boolean;
  loadingMore: boolean;
  /** Why the next page couldn't be loaded. */
  moreError: string | null;
  /** Loads the first page again. Never throws: a failure is reported through `error`. */
  refresh(): Promise<void>;
  /** Loads the next, older page, unless one is loading or there is none. */
  loadMore(): void;
}

interface Pages {
  /** What these pages were loaded for. */
  query: () => ExportFilters;
  /** The filters the first page was loaded with, which older pages keep. */
  filters: ExportFilters;
  exports: ExportEntry[] | null;
  nextBefore: string | null;
  error: string | null;
  loadingMore: boolean;
  moreError: string | null;
}

/**
 * The downloads matching the filters `query` works out, a page at a time. It is asked again for every first page, so
 * that a refresh moves a period counted back from now; older pages keep their first page's filters. Pass the same
 * function until the filters change.
 */
export function useDownloads(query: () => ExportFilters): Downloads {
  const { call } = useAuth();
  const [pages, setPages] = useState<Pages | null>(null);
  // Every first-page load gets a number: only the newest may land, and pages still arriving for an older one are
  // dropped. A list loaded for other filters is never shown, even for a frame.
  const generation = useRef(0);
  const loadingMoreFor = useRef<number | null>(null);
  const current = pages?.query === query ? pages : null;

  const refresh = useCallback(async () => {
    const attempt = ++generation.current;
    const filters = query();
    try {
      const page = await call((token) => api.exports(token, filters));
      if (attempt !== generation.current) return;
      setPages({ query, filters, exports: page.exports, nextBefore: page.nextBefore, error: null, loadingMore: false, moreError: null });
    } catch (error) {
      if (attempt !== generation.current || (error instanceof ApiError && error.status === 401)) return;
      const failed = { error: errorMessage(error), loadingMore: false, moreError: null };
      setPages((previous) =>
        previous?.query === query ? { ...previous, ...failed } : { query, filters, exports: null, nextBefore: null, ...failed },
      );
    }
  }, [call, query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function loadMore() {
    const before = current?.nextBefore;
    const attempt = generation.current;
    if (!current || !before || loadingMoreFor.current === attempt) return;
    const { filters } = current;
    loadingMoreFor.current = attempt;
    const update = (change: (loaded: Pages) => Pages) => {
      if (attempt === generation.current) setPages((previous) => previous && change(previous));
    };
    update((loaded) => ({ ...loaded, loadingMore: true, moreError: null }));
    try {
      const page = await call((token) => api.exports(token, filters, before));
      update((loaded) => ({ ...loaded, exports: [...(loaded.exports ?? []), ...page.exports], nextBefore: page.nextBefore, loadingMore: false }));
    } catch (error) {
      update((loaded) => ({ ...loaded, loadingMore: false, moreError: errorMessage(error) }));
    } finally {
      if (loadingMoreFor.current === attempt) loadingMoreFor.current = null;
    }
  }

  return {
    exports: current?.exports ?? null,
    error: current?.error ?? null,
    hasMore: Boolean(current?.nextBefore),
    loadingMore: current?.loadingMore ?? false,
    moreError: current?.moreError ?? null,
    refresh,
    loadMore: () => void loadMore(),
  };
}

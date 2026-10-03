import { useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { ConversationExport } from '@shared/api';
import { announce } from './announce';
import { api, ApiError } from './api';
import { useAuth } from './auth';
import type { Call } from './call';
import { timeZone } from './device';
import { canSaveExports, saveExport } from './export-file';
import { tapFeedback } from './haptics';

/** Said wherever a conversation is shared, so that nobody is surprised the download is logged. */
export const DOWNLOADS_RECORDED = 'Downloads are recorded for security.';

const CANT_SHARE = "This device can't share files.";
const NOT_SAVED = "The file couldn't be saved on this device. Try again.";
const BUSY = 'Another share is still being prepared. Try again in a moment.';

// One share is prepared at a time in the whole app, whichever screen starts it: both would be recorded, but a phone's
// share sheet takes one file at a time. Once a file is ready it goes straight to the share sheet, which covers the app.
let preparing = false;

export type ShareState =
  | { status: 'idle' }
  | { status: 'exporting' }
  | { status: 'done'; message: string }
  /** `retryable`: trying again may work, e.g. after a network error; not when there is nothing to share. */
  | { status: 'failed'; error: string; retryable: boolean };

export interface ShareConversation {
  state: ShareState;
  /** Downloads the conversation as a file: to the browser's downloads, or through the phone's share sheet. */
  share(conversationId: string): void;
  /** Forgets how the last share went. One still under way still hands its file over, but reports nothing here. */
  reset(): void;
}

/** Prepares the file and hands it over: how it went. Idle means the person was signed out (the sign-in screen says why). */
async function shareNow(call: Call, conversationId: string): Promise<ShareState> {
  if (preparing) return { status: 'failed', error: BUSY, retryable: true };
  preparing = true;
  try {
    let file: ConversationExport;
    try {
      // Checked first: a file this device can't take must not be recorded as handed out.
      if (!(await canSaveExports())) return { status: 'failed', error: CANT_SHARE, retryable: false };
      // Browsers download the file; phones hand it to the share sheet.
      const purpose = Platform.OS === 'web' ? 'download' : 'share';
      file = await call((token) => api.exportConversation(token, conversationId, { timeZone: timeZone(), purpose }));
    } finally {
      preparing = false;
    }
    await saveExport(file);
    const done = Platform.OS === 'web' ? 'Downloaded' : 'Exported';
    return { status: 'done', message: `${done} “${file.filename}”. ${DOWNLOADS_RECORDED}` };
  } catch (error) {
    if (!(error instanceof ApiError)) return { status: 'failed', error: NOT_SAVED, retryable: true };
    if (error.status === 401) return { status: 'idle' };
    // Unreachable (0), too many in a minute (429) or a server fault (5xx) can pass; a refusal stays one.
    const retryable = error.status === 0 || error.status === 429 || error.status >= 500;
    return { status: 'failed', error: error.message, retryable };
  }
}

export function useShareConversation(): ShareConversation {
  const { call } = useAuth();
  const [state, setState] = useState<ShareState>({ status: 'idle' });
  // Each share gets a number; only the latest may report how it went, or be tapped again while it runs.
  const latest = useRef(0);
  const running = useRef(false);

  async function share(conversationId: string) {
    if (running.current) return;
    const attempt = ++latest.current;
    tapFeedback();
    running.current = true;
    setState({ status: 'exporting' });
    const outcome = await shareNow(call, conversationId);
    if (attempt !== latest.current) return;
    running.current = false;
    setState(outcome);
    if (outcome.status === 'done') announce(outcome.message);
    if (outcome.status === 'failed') announce(outcome.error);
  }

  function reset() {
    latest.current++;
    running.current = false;
    setState({ status: 'idle' });
  }

  return { state, share: (conversationId) => void share(conversationId), reset };
}

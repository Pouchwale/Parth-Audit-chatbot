import { useRef, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import type { ConversationExport } from '@shared/api';
import { api, ApiError } from './api';
import { useAuth } from './auth';
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

export function useShareConversation(): ShareConversation {
  const { call } = useAuth();
  const [state, setState] = useState<ShareState>({ status: 'idle' });
  // Each share gets a number; only the latest may report how it went, or be tapped again while it runs.
  const latest = useRef(0);
  const running = useRef(false);

  async function share(conversationId: string) {
    if (running.current) return;
    const attempt = ++latest.current;
    const report = (next: ShareState) => {
      if (attempt !== latest.current) return;
      setState(next);
      if (next.status === 'done') announce(next.message);
      if (next.status === 'failed') announce(next.error);
    };
    tapFeedback();
    if (preparing) return report({ status: 'failed', error: BUSY, retryable: true });
    running.current = true;
    preparing = true;
    setState({ status: 'exporting' });
    try {
      let file: ConversationExport;
      try {
        // Checked first: a file this device can't take must not be recorded as handed out.
        if (!(await canSaveExports())) return report({ status: 'failed', error: CANT_SHARE, retryable: false });
        file = await call((token) => api.exportConversation(token, conversationId, { timeZone: timeZone() }));
      } finally {
        preparing = false;
      }
      await saveExport(file);
      const done = Platform.OS === 'web' ? 'Downloaded' : 'Exported';
      report({ status: 'done', message: `${done} “${file.filename}”. ${DOWNLOADS_RECORDED}` });
    } catch (error) {
      if (!(error instanceof ApiError)) return report({ status: 'failed', error: NOT_SAVED, retryable: true });
      if (error.status === 401) return report({ status: 'idle' }); // Signed out: the sign-in screen says why.
      // Unreachable (0), too many in a minute (429) or a server fault (5xx) can pass; a refusal stays one.
      const retryable = error.status === 0 || error.status === 429 || error.status >= 500;
      report({ status: 'failed', error: error.message, retryable });
    } finally {
      if (attempt === latest.current) running.current = false;
    }
  }

  function reset() {
    latest.current++;
    running.current = false;
    setState({ status: 'idle' });
  }

  return { state, share: (conversationId) => void share(conversationId), reset };
}

/**
 * Reads how a share went out loud on phones, where screen readers don't announce a notice appearing. Queued, so that
 * it follows what they say as the share sheet closes. Browsers announce the notice itself, by its alert role.
 */
function announce(message: string) {
  if (Platform.OS !== 'web') AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
}

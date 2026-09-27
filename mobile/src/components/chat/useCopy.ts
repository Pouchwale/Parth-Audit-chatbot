import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';

const COPIED_MS = 1500;

/** Copies text to the clipboard, and says so for a moment afterwards. */
export function useCopy(): { copied: boolean; copy(text: string): void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function copy(text: string) {
    // Started right in the press handler: Safari only lets a page write to the clipboard during a gesture.
    Clipboard.setStringAsync(text).then(
      (done) => {
        if (!done) return;
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      },
      () => undefined,
    );
  }

  return { copied, copy };
}

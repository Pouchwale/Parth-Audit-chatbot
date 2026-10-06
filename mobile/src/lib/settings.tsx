import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ReplyLanguage } from '@shared/api';
import { getItem, setItem } from './storage';

export type AppearancePreference = 'system' | 'light' | 'dark';

/** When replies are read aloud: never, only after the person spoke their request, or always. */
export type ReadAloudPreference = 'never' | 'afterVoice' | 'always';

export type { ReplyLanguage };

export interface Settings {
  appearance: AppearancePreference;
  readAloud: ReadAloudPreference;
  /** Send a transcribed voice message straight away instead of putting it in the composer to edit. */
  autoSendVoice: boolean;
  /** The language Mitra answers in: the one the person writes in ("auto"), or always English, Gujarati or Hindi. */
  replyLanguage: ReplyLanguage;
}

interface SettingsValue {
  settings: Settings;
  update(changes: Partial<Settings>): void;
}

const STORAGE_KEY = 'settings';
const DEFAULTS: Settings = { appearance: 'system', readAloud: 'afterVoice', autoSendVoice: true, replyLanguage: 'auto' };
const APPEARANCES: readonly AppearancePreference[] = ['system', 'light', 'dark'];
const READ_ALOUD: readonly ReadAloudPreference[] = ['never', 'afterVoice', 'always'];
const REPLY_LANGUAGES: readonly ReplyLanguage[] = ['auto', 'en', 'gu', 'hi'];

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

/** Saved settings, with defaults for anything missing or unrecognised (e.g. saved by an older version). */
function parse(saved: string | null): Settings {
  if (!saved) return DEFAULTS;
  try {
    const value = JSON.parse(saved) as Partial<Record<keyof Settings, unknown>>;
    return {
      appearance: oneOf(value.appearance, APPEARANCES, DEFAULTS.appearance),
      readAloud: oneOf(value.readAloud, READ_ALOUD, DEFAULTS.readAloud),
      autoSendVoice: typeof value.autoSendVoice === 'boolean' ? value.autoSendVoice : DEFAULTS.autoSendVoice,
      replyLanguage: oneOf(value.replyLanguage, REPLY_LANGUAGES, DEFAULTS.replyLanguage),
    };
  } catch {
    return DEFAULTS;
  }
}

// The requests that run a turn carry the reply language (chat-stream.ts), and they are made outside React: so the
// setting is also kept here, as it is loaded and changed, the way device.ts keeps the time zone.
let replyLanguageNow: ReplyLanguage = DEFAULTS.replyLanguage;

/** The language Mitra is to answer in, as the settings say now (ReplyLanguage in shared/api.ts). */
export function replyLanguage(): ReplyLanguage {
  return replyLanguageNow;
}

const SettingsContext = createContext<SettingsValue | null>(null);

/** Loads the saved settings before rendering anything, so the first frame already has the right theme. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    getItem(STORAGE_KEY)
      .then(parse, () => DEFAULTS)
      .then((loaded) => {
        replyLanguageNow = loaded.replyLanguage;
        setSettings(loaded);
      });
  }, []);

  const value = useMemo<SettingsValue | null>(
    () =>
      settings && {
        settings,
        update(changes) {
          const next = { ...settings, ...changes };
          replyLanguageNow = next.replyLanguage;
          setSettings(next);
          // If saving fails the change still applies until the app restarts.
          setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
        },
      },
    [settings],
  );

  if (!value) return null;
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside <SettingsProvider>');
  return value;
}

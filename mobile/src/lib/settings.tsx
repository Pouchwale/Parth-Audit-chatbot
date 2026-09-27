import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getItem, setItem } from './storage';

export type AppearancePreference = 'system' | 'light' | 'dark';

/** When replies are read aloud: never, only after the person spoke their request, or always. */
export type ReadAloudPreference = 'never' | 'afterVoice' | 'always';

export interface Settings {
  appearance: AppearancePreference;
  readAloud: ReadAloudPreference;
  /** Send a transcribed voice message straight away instead of putting it in the composer to edit. */
  autoSendVoice: boolean;
}

interface SettingsValue {
  settings: Settings;
  update(changes: Partial<Settings>): void;
}

const STORAGE_KEY = 'settings';
const DEFAULTS: Settings = { appearance: 'system', readAloud: 'afterVoice', autoSendVoice: true };
const APPEARANCES: readonly AppearancePreference[] = ['system', 'light', 'dark'];
const READ_ALOUD: readonly ReadAloudPreference[] = ['never', 'afterVoice', 'always'];

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
    };
  } catch {
    return DEFAULTS;
  }
}

const SettingsContext = createContext<SettingsValue | null>(null);

/** Loads the saved settings before rendering anything, so the first frame already has the right theme. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    getItem(STORAGE_KEY).then(parse, () => DEFAULTS).then(setSettings);
  }, []);

  const value = useMemo<SettingsValue | null>(
    () =>
      settings && {
        settings,
        update(changes) {
          const next = { ...settings, ...changes };
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

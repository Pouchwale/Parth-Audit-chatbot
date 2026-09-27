import { DarkTheme, DefaultTheme, type Theme as NavigationTheme } from 'expo-router';
import { useColorScheme } from 'react-native';
import { useSettings } from '@/lib/settings';

// Warm neutrals with a single clay accent: calm and content-first.
export const Colors = {
  light: {
    text: '#1F1E1D',
    textSecondary: '#6B6962',
    background: '#FAF9F5',
    sidebar: '#F3F1EA',
    surface: '#FFFFFF',
    surfaceMuted: '#EFEDE5',
    border: '#E3E0D6',
    overlay: 'rgba(31, 30, 29, 0.4)',
    accent: '#B8532F',
    onAccent: '#FFFFFF',
    accentSoft: '#F5E4DB',
    danger: '#B42318',
    dangerSoft: '#FCEAE8',
    success: '#2E7A4E',
    successSoft: '#E3F1E7',
    warning: '#8A5A00',
    warningSoft: '#FAEFD6',
  },
  dark: {
    text: '#F4F3EE',
    textSecondary: '#A8A59C',
    background: '#262624',
    sidebar: '#1F1E1D',
    surface: '#30302E',
    surfaceMuted: '#3A3936',
    border: '#44433F',
    overlay: 'rgba(0, 0, 0, 0.55)',
    accent: '#D97757',
    onAccent: '#1F1E1D',
    accentSoft: '#48302A',
    danger: '#FF8A7F',
    dangerSoft: '#46231F',
    success: '#6CC790',
    successSoft: '#1F3527',
    warning: '#F0BF5E',
    warningSoft: '#3E3219',
  },
} as const;

export type ColorScheme = keyof typeof Colors;
export type Theme = (typeof Colors)[ColorScheme];

/** The scheme the app shows: the person's choice in Settings, or the device's when they chose System. */
export function useColorSchemeSetting(): ColorScheme {
  const device = useColorScheme();
  const { appearance } = useSettings().settings;
  if (appearance !== 'system') return appearance;
  return device === 'dark' ? 'dark' : 'light';
}

export function useTheme(): Theme {
  return Colors[useColorSchemeSetting()];
}

/** Colours for navigation headers, drawers and screen backgrounds. */
export function navigationTheme(scheme: ColorScheme): NavigationTheme {
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const colors = Colors[scheme];
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.accent,
      background: colors.background,
      card: colors.background,
      text: colors.text,
      border: colors.border,
      notification: colors.accent,
    },
  };
}

export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const Radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;
export const MaxContentWidth = 720;

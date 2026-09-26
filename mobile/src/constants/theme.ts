import { useColorScheme } from 'react-native';

export const Colors = {
  light: {
    text: '#11181C',
    textSecondary: '#5F6B7A',
    background: '#F4F6F9',
    surface: '#FFFFFF',
    surfaceMuted: '#EBEFF4',
    border: '#DDE3EA',
    accent: '#2F5BEA',
    onAccent: '#FFFFFF',
    accentSoft: '#E5EBFD',
    danger: '#C62828',
    dangerSoft: '#FDECEC',
    success: '#1E7F4F',
    successSoft: '#E3F3EA',
    warning: '#8A5A00',
    warningSoft: '#FFF3D6',
  },
  dark: {
    text: '#ECEEF1',
    textSecondary: '#9BA5B1',
    background: '#0D1015',
    surface: '#171B22',
    surfaceMuted: '#20252D',
    border: '#2B323C',
    accent: '#7B97FF',
    onAccent: '#0B0F17',
    accentSoft: '#1C2544',
    danger: '#FF7070',
    dangerSoft: '#3A1D20',
    success: '#4CC38A',
    successSoft: '#143020',
    warning: '#F5BE4F',
    warningSoft: '#372B10',
  },
} as const;

export type Theme = (typeof Colors)['light'] | (typeof Colors)['dark'];

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? Colors.dark : Colors.light;
}

export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const Radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;
export const MaxContentWidth = 720;

import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { Radius, useTheme, type Theme } from '@/constants/theme';
import { fileKind, type FileKind } from '@/lib/file-types';

const ICONS: Record<FileKind, ComponentProps<typeof Ionicons>['name']> = {
  pdf: 'document-text',
  image: 'image',
  document: 'document-text',
  spreadsheet: 'grid',
  text: 'document-text-outline',
  other: 'document-outline',
};

// Each kind in the colour people know it by: PDFs red, Word blue, spreadsheets green.
const COLORS: Record<FileKind, (theme: Theme) => [background: string, icon: string]> = {
  pdf: (theme) => [theme.dangerSoft, theme.danger],
  image: (theme) => [theme.accentSoft, theme.accent],
  document: (theme) => [theme.infoSoft, theme.info],
  spreadsheet: (theme) => [theme.successSoft, theme.success],
  text: (theme) => [theme.surfaceMuted, theme.textSecondary],
  other: (theme) => [theme.surfaceMuted, theme.textSecondary],
};

/** A square tile showing what kind of file this is. */
export function FileIcon({ mimeType, size = 40 }: { mimeType: string; size?: number }) {
  const theme = useTheme();
  const kind = fileKind(mimeType);
  const [background, color] = COLORS[kind](theme);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.tile, { width: size, height: size, backgroundColor: background }]}>
      <Ionicons name={ICONS[kind]} size={Math.round(size * 0.5)} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
});

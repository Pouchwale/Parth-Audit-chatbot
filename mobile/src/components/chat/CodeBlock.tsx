import Ionicons from '@expo/vector-icons/Ionicons';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { useCopy } from './useCopy';

export const MONOSPACE = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
});

/** A fenced code block: monospace on a surface, scrolling sideways, with a copy button. */
export function CodeBlock({ code, language }: { code: string; language?: string }) {
  const theme = useTheme();
  const { copied, copy } = useCopy();
  return (
    <View style={[styles.block, { backgroundColor: theme.surfaceMuted }]}>
      <View style={styles.bar}>
        <Text style={[styles.language, { color: theme.textSecondary }]}>{language || 'code'}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copied ? 'Code copied' : 'Copy code'}
          onPress={() => copy(code)}
          hitSlop={8}
          style={styles.copy}>
          <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={14} color={theme.textSecondary} />
          <Text style={[styles.copyLabel, { color: theme.textSecondary }]}>{copied ? 'Copied' : 'Copy'}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text selectable style={[styles.code, { color: theme.text }]}>
          {code}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { borderRadius: Radius.md, marginVertical: Spacing.xs, overflow: 'hidden' },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  language: { fontSize: 12 },
  copy: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  copyLabel: { fontSize: 12 },
  scroll: { padding: Spacing.md },
  code: { fontFamily: MONOSPACE, fontSize: 13, lineHeight: 20 },
});

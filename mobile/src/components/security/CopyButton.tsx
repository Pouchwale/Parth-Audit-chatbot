import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useCopy } from '@/components/chat/useCopy';
import { Radius, Spacing, useTheme } from '@/constants/theme';

/** Copies `text`, and says so for a moment. `label` says what is copied, for screen readers. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const theme = useTheme();
  const { copied, copy } = useCopy();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copied ? 'Copied' : label}
      onPress={() => copy(text)}
      hitSlop={8}
      style={({ pressed }) => [styles.button, { borderColor: theme.border, backgroundColor: pressed ? theme.surfaceMuted : theme.surface }]}>
      <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={14} color={theme.textSecondary} />
      <Text style={[styles.label, { color: theme.textSecondary }]}>{copied ? 'Copied' : 'Copy'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: 32,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  label: { fontSize: 13, fontWeight: '600' },
});

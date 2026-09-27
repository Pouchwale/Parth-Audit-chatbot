import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Radius, Spacing, useTheme } from '@/constants/theme';

/** Why something in the chat failed, with a button to try again when that can help. */
export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.row} accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle" size={18} color={theme.danger} style={styles.icon} />
      <Text style={[styles.message, { color: theme.danger }]}>{message}</Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          hitSlop={8}
          style={({ pressed }) => [styles.retry, { borderColor: theme.border, backgroundColor: pressed ? theme.surfaceMuted : theme.surface }]}>
          <Ionicons name="refresh" size={15} color={theme.text} />
          <Text style={[styles.retryLabel, { color: theme.text }]}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  icon: { alignSelf: 'flex-start', marginTop: 1 },
  message: { flex: 1, minWidth: 160, fontSize: 14, lineHeight: 20 },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: 32,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  retryLabel: { fontSize: 14, fontWeight: '600' },
});

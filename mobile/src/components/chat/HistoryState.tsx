import { StyleSheet, View } from 'react-native';
import { Button, Notice } from '@/components/ui';
import { Spacing, useTheme } from '@/constants/theme';

const REPLY_LINES = ['92%', '100%', '64%'] as const;

/** Placeholder messages shaped like a conversation, while a saved one loads. */
export function HistorySkeleton() {
  const theme = useTheme();
  const bar = { backgroundColor: theme.surfaceMuted };
  return (
    <View accessible accessibilityLabel="Loading conversation" style={styles.skeleton}>
      <View style={[styles.userBubble, bar]} />
      <View style={styles.reply}>
        <View style={[styles.mark, bar]} />
        <View style={styles.lines}>
          {REPLY_LINES.map((width, index) => (
            <View key={index} style={[styles.line, bar, { width }]} />
          ))}
        </View>
      </View>
    </View>
  );
}

/** Why a saved conversation couldn't be loaded, with what the person can do about it. */
export function HistoryError({
  message,
  gone,
  onRetry,
  onNewChat,
}: {
  message: string;
  /** The conversation no longer exists, so trying again won't help. */
  gone: boolean;
  onRetry(): void;
  onNewChat(): void;
}) {
  return (
    <View style={styles.error}>
      <Notice tone="danger">{message}</Notice>
      {gone ? <Button title="Start a new chat" onPress={onNewChat} /> : <Button title="Try again" kind="secondary" onPress={onRetry} />}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { flex: 1, justifyContent: 'flex-end', padding: Spacing.lg, gap: Spacing.xl },
  userBubble: { alignSelf: 'flex-end', width: '55%', height: 44, borderRadius: 20 },
  reply: { flexDirection: 'row', gap: Spacing.md },
  mark: { width: 28, height: 28, borderRadius: 14 },
  lines: { flex: 1, gap: Spacing.sm, paddingTop: 4 },
  line: { height: 14, borderRadius: 7 },
  error: { flex: 1, justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
});

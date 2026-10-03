import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Spacing, useTheme } from '@/constants/theme';

const TICK_MS = 500;

/**
 * Shown where the thinking dots go while the assistant's model is busy and the server waits to try again: a calm
 * line counting down the wait. It goes when the reply resumes.
 */
export function WaitingLine({ waiting }: { waiting: { retryInMs: number; since: number } }) {
  const theme = useTheme();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const secondsLeft = Math.max(0, Math.ceil((waiting.since + waiting.retryInMs - now) / 1000));
  return (
    <View accessibilityLiveRegion="polite" style={styles.row}>
      <ActivityIndicator size="small" color={theme.textSecondary} />
      <Text style={[styles.text, { color: theme.textSecondary }]}>
        {secondsLeft > 0 ? `The AI service is busy. Continuing in ${secondsLeft} s` : 'The AI service is busy. Continuing now'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 24, paddingVertical: Spacing.xs },
  text: { flex: 1, fontSize: 14, lineHeight: 20 },
});

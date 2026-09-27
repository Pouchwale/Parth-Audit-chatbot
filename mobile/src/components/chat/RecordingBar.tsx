import { Animated, StyleSheet, Text, View } from 'react-native';
import { Spacing, useTheme } from '@/constants/theme';
import { LEVEL_COUNT } from '@/lib/voice';
import { ComposerButton } from './ComposerButton';
import { useLoop } from './useLoop';

const BAR_MAX_HEIGHT = 22;

function elapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Takes the message box's place while the person speaks: time, live level bars, Cancel and Done. */
export function RecordingBar({
  elapsedMs,
  levels,
  doneLabel,
  onCancel,
  onDone,
}: {
  elapsedMs: number;
  levels: readonly number[];
  doneLabel: string;
  onCancel(): void;
  onDone(): void;
}) {
  const theme = useTheme();
  const pulse = useLoop(1400);
  // Newest level on the right; silence fills the rest until the bars are full.
  const bars = [...Array<number>(Math.max(0, LEVEL_COUNT - levels.length)).fill(0), ...levels];

  return (
    <View style={styles.bar}>
      <ComposerButton icon="close" label="Cancel recording" onPress={onCancel} />
      <View style={styles.middle} accessible accessibilityLabel={`Recording, ${elapsed(elapsedMs)}`}>
        <Animated.View
          style={[
            styles.dot,
            { backgroundColor: theme.danger, opacity: pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.25, 1] }) },
          ]}
        />
        <Text style={[styles.time, { color: theme.text }]}>{elapsed(elapsedMs)}</Text>
        <View style={styles.levels}>
          {bars.map((level, index) => (
            <View key={index} style={[styles.level, { height: 3 + level * (BAR_MAX_HEIGHT - 3), backgroundColor: theme.accent }]} />
          ))}
        </View>
      </View>
      <ComposerButton icon="checkmark" label={doneLabel} onPress={onDone} primary />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  middle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  time: { fontSize: 15, fontVariant: ['tabular-nums'], minWidth: 36 },
  levels: { flex: 1, height: BAR_MAX_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2, overflow: 'hidden' },
  level: { width: 3, borderRadius: 1.5 },
});

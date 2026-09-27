import { Animated, StyleSheet, View } from 'react-native';
import { Spacing, useTheme } from '@/constants/theme';
import { useLoop } from './useLoop';

// Each dot brightens in turn.
const WAVES = [
  [1, 0.3, 0.3, 1],
  [0.3, 1, 0.3, 0.3],
  [0.3, 0.3, 1, 0.3],
];

/** Three softly pulsing dots while the assistant works on the next part of its reply. */
export function Thinking() {
  const theme = useTheme();
  const progress = useLoop(1200);
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Assistant is thinking" style={styles.row}>
      {WAVES.map((wave, index) => (
        <Animated.View
          key={index}
          style={[
            styles.dot,
            { backgroundColor: theme.textSecondary, opacity: progress.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: wave }) },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 24, paddingVertical: Spacing.xs },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
});

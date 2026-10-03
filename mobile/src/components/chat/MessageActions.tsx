import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { speak, stopSpeaking } from '@/lib/speech';
import { useCopy } from './useCopy';

/** Copy and Read aloud, under a finished reply. */
export function MessageActions({ id, text, reading }: { id: string; text: string; reading: boolean }) {
  const { copied, copy } = useCopy();
  return (
    <View style={styles.row}>
      <Action icon={copied ? 'checkmark' : 'copy-outline'} label={copied ? 'Copied' : 'Copy'} onPress={() => copy(text)} />
      <Action
        icon={reading ? 'stop-circle-outline' : 'volume-high-outline'}
        label={reading ? 'Stop reading' : 'Read aloud'}
        onPress={() => (reading ? stopSpeaking() : speak(text, id))}
      />
    </View>
  );
}

// 44 points tall: the smallest touch target a fingertip hits reliably. The rows pull the box's spare height back in,
// so the actions sit as close under a message as before.
const ACTION_HEIGHT = 44;

/** A small labelled action under a message. `off` shows it dimmed; the press still happens, so it can say why. */
export function Action({
  icon,
  label,
  accessibilityLabel,
  accessibilityHint,
  off = false,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  off?: boolean;
  onPress(): void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: off }}
      aria-disabled={off}
      onPress={onPress}
      style={({ pressed }) => [styles.action, { backgroundColor: pressed ? theme.surfaceMuted : 'transparent', opacity: off ? 0.45 : 1 }]}>
      <Ionicons name={icon} size={16} color={theme.textSecondary} />
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.xs, marginLeft: -Spacing.sm, marginVertical: -Spacing.xs },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: ACTION_HEIGHT,
    paddingHorizontal: Spacing.sm + 2,
    borderRadius: Radius.sm,
  },
  label: { fontSize: 13 },
});

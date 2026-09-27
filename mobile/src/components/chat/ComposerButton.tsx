import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { Radius, useTheme } from '@/constants/theme';

/** A round button in the message box: filled with the accent colour for the main action, plain otherwise. */
export function ComposerButton({
  icon,
  label,
  onPress,
  primary = false,
  disabled = false,
  busy = false,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress(): void;
  primary?: boolean;
  disabled?: boolean;
  /** Working on it: shows a spinner and ignores presses. */
  busy?: boolean;
}) {
  const theme = useTheme();
  const color = primary ? theme.onAccent : theme.textSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={disabled || busy}
      aria-busy={busy}
      disabled={disabled || busy}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? theme.accent : pressed ? theme.surfaceMuted : 'transparent',
          opacity: disabled ? 0.4 : pressed && primary ? 0.85 : 1,
        },
      ]}>
      {busy ? <ActivityIndicator size="small" color={color} /> : <Ionicons name={icon} size={20} color={color} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

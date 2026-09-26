import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { Radius, Spacing, useTheme } from '@/constants/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  busy,
  style,
}: {
  title: string;
  onPress(): void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const colors = {
    primary: { background: theme.accent, text: theme.onAccent, border: theme.accent },
    secondary: { background: theme.surface, text: theme.text, border: theme.border },
    danger: { background: theme.surface, text: theme.danger, border: theme.danger },
  }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.background, borderColor: colors.border, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}>
      {busy ? <ActivityIndicator color={colors.text} /> : <Text style={[styles.buttonText, { color: colors.text }]}>{title}</Text>}
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, color }: { icon: IconName; label: string; onPress(): void; color?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? theme.surfaceMuted : 'transparent' }]}>
      <Ionicons name={icon} size={22} color={color ?? theme.text} />
    </Pressable>
  );
}

export function Field({ label, ...input }: TextInputProps & { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{label}</Text>
      <TextInput
        placeholderTextColor={theme.textSecondary}
        {...input}
        style={[styles.fieldInput, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
      />
    </View>
  );
}

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export function Chip({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const theme = useTheme();
  const colors = {
    neutral: [theme.surfaceMuted, theme.textSecondary],
    accent: [theme.accentSoft, theme.accent],
    success: [theme.successSoft, theme.success],
    warning: [theme.warningSoft, theme.warning],
    danger: [theme.dangerSoft, theme.danger],
  }[tone];
  return (
    <View style={[styles.chip, { backgroundColor: colors[0] }]}>
      <Text style={[styles.chipText, { color: colors[1] }]}>{label}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const theme = useTheme();
  return <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>{children}</Text>;
}

export function Notice({ children, tone = 'warning' }: { children: ReactNode; tone?: 'warning' | 'danger' }) {
  const theme = useTheme();
  const [background, text] = tone === 'danger' ? [theme.dangerSoft, theme.danger] : [theme.warningSoft, theme.warning];
  return (
    <View style={[styles.notice, { backgroundColor: background }]}>
      <Text style={{ color: text, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  iconButton: { width: 40, height: 40, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  field: { gap: Spacing.xs },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  fieldInput: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  chip: { alignSelf: 'flex-start', paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.pill },
  chipText: { fontSize: 12, fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: Spacing.xl,
    marginBottom: Spacing.sm,
  },
  notice: { borderRadius: Radius.md, padding: Spacing.md },
});

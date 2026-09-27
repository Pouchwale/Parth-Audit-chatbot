import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Radius, Spacing, useColorSchemeSetting, useTheme } from '@/constants/theme';

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

/** A labelled text input. `secret` hides the text and adds an eye button to show it. */
export function Field({ label, secret, ...input }: TextInputProps & { label: string; secret?: boolean }) {
  const theme = useTheme();
  const scheme = useColorSchemeSetting();
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{label}</Text>
      <View style={[styles.fieldBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <TextInput
          placeholderTextColor={theme.textSecondary}
          keyboardAppearance={scheme}
          {...input}
          secureTextEntry={secret ? !revealed : input.secureTextEntry}
          accessibilityLabel={label}
          style={[styles.fieldInput, { color: theme.text }]}
        />
        {secret ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            onPress={() => setRevealed(!revealed)}
            hitSlop={8}
            style={styles.eye}>
            <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={22} color={theme.textSecondary} />
          </Pressable>
        ) : null}
      </View>
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

/** A round badge with the first letter of the person's name. */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const theme = useTheme();
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.accentSoft }]}>
      <Text style={[styles.avatarText, { color: theme.accent, fontSize: Math.round(size * 0.42) }]}>{initial}</Text>
    </View>
  );
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  /** Read by screen readers for the whole group. */
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange(value: T): void;
}) {
  const theme = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.segments, { backgroundColor: theme.surfaceMuted }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            aria-checked={selected}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && { backgroundColor: theme.accentSoft }]}>
            <Text style={[styles.segmentText, { color: selected ? theme.accent : theme.textSecondary }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const THUMB_COLOR = '#FFFFFF';
// react-native-web colours the thumb of a switched-on Switch from this prop of its own.
const webThumbColor = Platform.OS === 'web' ? { activeThumbColor: THUMB_COLOR } : null;

/** An on/off switch that looks the same on iOS, Android and web. */
export function Toggle({ label, value, onValueChange }: { label: string; value: boolean; onValueChange(value: boolean): void }) {
  const theme = useTheme();
  return (
    <Switch
      accessibilityLabel={label}
      value={value}
      onValueChange={onValueChange}
      trackColor={{ true: theme.accent, false: theme.border }}
      ios_backgroundColor={theme.border}
      thumbColor={THUMB_COLOR}
      {...webThumbColor}
    />
  );
}

/** A small modal card over a dimmed backdrop, shown while it is mounted. Tapping outside closes it. */
export function Dialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const theme = useTheme();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={styles.dialogRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]}
        />
        <View aria-modal style={[styles.dialog, { backgroundColor: theme.surface }]}>
          <Text accessibilityRole="header" numberOfLines={2} style={[styles.dialogTitle, { color: theme.text }]}>
            {title}
          </Text>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
  fieldBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: Radius.md },
  fieldInput: { flex: 1, minHeight: 48, paddingHorizontal: Spacing.md, fontSize: 16 },
  eye: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
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
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '700' },
  segments: { flexDirection: 'row', borderRadius: Radius.md, padding: 3, gap: 3 },
  segment: { flex: 1, minHeight: 36, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.sm },
  segmentText: { fontSize: 14, fontWeight: '600' },
  dialogRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  dialog: { width: '100%', maxWidth: 400, borderRadius: Radius.lg, padding: Spacing.xl, gap: Spacing.md },
  dialogTitle: { fontSize: 18, fontWeight: '700' },
});

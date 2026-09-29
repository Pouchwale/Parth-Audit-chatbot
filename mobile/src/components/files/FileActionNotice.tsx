import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import type { FileActionState } from '@/lib/file-actions';

/** How opening, downloading or sharing a file went, under the file. */
export function FileActionNotice({ state, onDismiss, style }: { state: FileActionState; onDismiss(): void; style?: ViewStyle }) {
  const theme = useTheme();
  if (state.status === 'idle' || state.status === 'busy') return null;
  const [background, color, icon, text] =
    state.status === 'failed'
      ? ([theme.dangerSoft, theme.danger, 'alert-circle', state.error] as const)
      : state.status === 'ready'
        ? ([theme.accentSoft, theme.accent, 'share-outline', state.message] as const)
        : ([theme.successSoft, theme.success, 'checkmark-circle', state.message] as const);
  return (
    <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: background }, style]}>
      <Ionicons name={icon} size={16} color={color} style={styles.icon} />
      <Text style={[styles.text, { color }]}>{text}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onDismiss} hitSlop={8}>
        <Ionicons name="close" size={16} color={color} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  icon: { alignSelf: 'flex-start', marginTop: 2 },
  text: { flex: 1, fontSize: 13, lineHeight: 18 },
});

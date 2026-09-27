import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useEffectEvent } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import type { ShareState } from '@/lib/share';

const DONE_SHOWN_MS = 6000;

/** How sharing the conversation went, floating over the top of the chat. A success goes away by itself. */
export function ShareNotice({ state, onDismiss }: { state: ShareState; onDismiss(): void }) {
  const theme = useTheme();
  const dismiss = useEffectEvent(onDismiss);

  useEffect(() => {
    if (state.status !== 'done') return;
    const timer = setTimeout(() => dismiss(), DONE_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [state]);

  if (state.status !== 'done' && state.status !== 'failed') return null;
  const failed = state.status === 'failed';
  const [background, color] = failed ? [theme.dangerSoft, theme.danger] : [theme.successSoft, theme.success];
  return (
    <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: background, borderColor: theme.border }]}>
      <Ionicons name={failed ? 'alert-circle' : 'checkmark-circle'} size={18} color={color} style={styles.icon} />
      <Text style={[styles.text, { color }]}>{failed ? state.error : state.message}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onDismiss} hitSlop={8}>
        <Ionicons name="close" size={18} color={color} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.md,
    right: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  icon: { alignSelf: 'flex-start', marginTop: 1 },
  text: { flex: 1, fontSize: 14, lineHeight: 20 },
});

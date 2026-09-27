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

function Action({ icon, label, onPress }: { icon: ComponentProps<typeof Ionicons>['name']; label: string; onPress(): void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.action, { backgroundColor: pressed ? theme.surfaceMuted : 'transparent' }]}>
      <Ionicons name={icon} size={16} color={theme.textSecondary} />
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.xs, marginLeft: -Spacing.sm },
  action: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, minHeight: 32, paddingHorizontal: Spacing.sm, borderRadius: Radius.sm },
  label: { fontSize: 13 },
});

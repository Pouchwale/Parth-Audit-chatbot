import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ExportEntry } from '@shared/api';
import { Avatar } from '@/components/ui';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { fullDateTime } from '@/lib/dates';
import { WEB_BROWSER_MODEL } from '@/lib/device';
import { deviceSummary, fileSize } from '@/lib/format';

/** One download in the list: who, which conversation, exactly when, from which device and address. */
export function DownloadRow({ entry }: { entry: ExportEntry }) {
  const theme = useTheme();
  const when = fullDateTime(entry.at);
  const where = [deviceSummary(entry.device) ?? 'Unknown device', entry.ip ? `IP ${entry.ip}` : null].filter(Boolean).join(' · ');
  // Phones' browsers name the phone as the model, and the app names the device.
  const onComputer = entry.device?.model === WEB_BROWSER_MODEL;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.conversationTitle}, downloaded by ${entry.user.displayName} on ${when}`}
      accessibilityHint="Shows everything recorded about this download"
      onPress={() => router.push({ pathname: '/admin/exports/[exportId]', params: { exportId: entry.id } })}
      style={({ pressed }) => [styles.row, { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 }]}>
      <View style={styles.top}>
        <Avatar name={entry.user.displayName} size={32} />
        <View style={styles.flex}>
          <Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>
            {entry.user.displayName}
          </Text>
          <Text numberOfLines={1} style={[styles.meta, { color: theme.textSecondary }]}>
            {entry.user.username}
          </Text>
        </View>
        <Text style={[styles.meta, { color: theme.textSecondary }]}>{fileSize(entry.sizeBytes)}</Text>
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      </View>
      <Text numberOfLines={2} style={[styles.title, { color: theme.text }]}>
        {entry.conversationTitle}
      </Text>
      <Fact icon="time-outline" text={when} />
      <Fact icon={onComputer ? 'desktop-outline' : 'phone-portrait-outline'} text={where} />
    </Pressable>
  );
}

function Fact({ icon, text }: { icon: ComponentProps<typeof Ionicons>['name']; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={15} color={theme.textSecondary} style={styles.factIcon} />
      <Text style={[styles.meta, styles.flex, { color: theme.textSecondary }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  flex: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700' },
  title: { fontSize: 15, lineHeight: 21, fontWeight: '500' },
  meta: { fontSize: 13, lineHeight: 18 },
  fact: { flexDirection: 'row', gap: Spacing.sm },
  factIcon: { marginTop: 1 },
});

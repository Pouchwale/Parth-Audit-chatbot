import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { WeeklyUserSummary } from '@shared/api';
import { Avatar } from '@/components/ui';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { fullDateTime, fullDateTimeIn } from '@/lib/dates';
import { count, fileSize } from '@/lib/format';

/**
 * What one person did in a week. Pressing it shows the downloads behind the numbers. Times are in `timeZone`, the
 * report's, so they fall within the week as the report counts it.
 */
export function PersonWeekCard({ summary, timeZone, onPress }: { summary: WeeklyUserSummary; timeZone: string; onPress(): void }) {
  const theme = useTheme();
  const { user, lastActiveAt } = summary;
  const changes = `${summary.changesConfirmed} made · ${summary.changesCancelled} cancelled · ${summary.changesFailed} failed`;
  const downloads = summary.exports > 0 ? `${summary.exports} (${fileSize(summary.exportedBytes)})` : '0';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${user.displayName}, ${user.username}. ${count(summary.messages, 'message')}, ${count(summary.exports, 'download')}${
        summary.failedSignIns > 0 ? `, ${count(summary.failedSignIns, 'failed sign-in')}` : ''
      }`}
      accessibilityHint="Shows their downloads that week"
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 }]}>
      <View style={styles.top}>
        <Avatar name={user.displayName} size={36} />
        <View style={styles.flex}>
          <Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>
            {user.displayName}
          </Text>
          <Text numberOfLines={1} style={[styles.meta, { color: theme.textSecondary }]}>
            {user.username}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      </View>

      <View style={styles.facts}>
        <Fact label="Messages" value={summary.messages.toLocaleString()} />
        <Fact label="Lookups" value={summary.lookups.toLocaleString()} />
        <Fact label="Uploads" value={summary.uploads.toLocaleString()} />
        <Fact label="Devices" value={summary.devices.toLocaleString()} />
        <Fact label="Downloads" value={downloads} />
        <Fact label="Sign-ins" value={summary.signIns.toLocaleString()} />
        <Fact label="Failed sign-ins" value={summary.failedSignIns.toLocaleString()} alarming={summary.failedSignIns > 0} />
      </View>
      <Fact label="Changes" value={changes} />

      <Names label="Downloaded conversations" names={summary.exportedConversations} />
      <Names label="Files opened, downloaded or shared" names={summary.downloadedFiles} />

      <Text style={[styles.meta, { color: theme.textSecondary }]}>
        {lastActiveAt ? `Last active ${fullDateTimeIn(lastActiveAt, timeZone) ?? fullDateTime(lastActiveAt)}` : 'Sent no messages this week'}
      </Text>
    </Pressable>
  );
}

/** A list of titles or file names, when there are any. */
function Names({ label, names }: { label: string; names: readonly string[] }) {
  const theme = useTheme();
  if (names.length === 0) return null;
  return (
    <View style={styles.titles}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
      {names.map((name, index) => (
        <Text key={index} numberOfLines={2} style={[styles.value, { color: theme.text }]}>
          • {name}
        </Text>
      ))}
    </View>
  );
}

function Fact({ label, value, alarming = false }: { label: string; value: string; alarming?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.fact}>
      <Text style={[styles.label, { color: alarming ? theme.danger : theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.value, alarming ? { color: theme.danger, fontWeight: '700' } : { color: theme.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  flex: { flex: 1 },
  name: { fontSize: 16, fontWeight: '700' },
  meta: { fontSize: 13, lineHeight: 18 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Spacing.md },
  fact: { flexBasis: '33%', flexGrow: 1, minWidth: 96, gap: 2 },
  label: { fontSize: 12, fontWeight: '600' },
  value: { fontSize: 15, lineHeight: 21 },
  titles: { gap: 2 },
});

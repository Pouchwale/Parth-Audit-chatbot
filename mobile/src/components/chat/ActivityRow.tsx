import { StyleSheet, Text, View } from 'react-native';
import type { ActivityPart } from '@shared/api';
import { Spacing, useTheme } from '@/constants/theme';
import { STATUS_LABEL } from '@/lib/format';
import { StatusIcon } from './StatusIcon';

/** One lookup the assistant ran in a connected system, as a compact row. */
export function ActivityRow({ activity }: { activity: ActivityPart }) {
  const theme = useTheme();
  const error = activity.status === 'failed' ? activity.error : null;
  return (
    <View
      accessible
      accessibilityLabel={`${STATUS_LABEL[activity.status]}: ${activity.summary}, in ${activity.system}.${error ? ` ${error}` : ''}`}
      style={styles.row}>
      <View style={styles.icon}>
        <StatusIcon status={activity.status} />
      </View>
      <View style={styles.text}>
        <Text style={[styles.summary, { color: theme.text }]}>
          {activity.summary}
          <Text style={{ color: theme.textSecondary }}>{`  ·  ${activity.system}`}</Text>
        </Text>
        {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.xs },
  icon: { height: 20, justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  summary: { fontSize: 14, lineHeight: 20 },
  error: { fontSize: 13, lineHeight: 18 },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WeeklyReportSummary, WeeklyTotals } from '@shared/api';
import { Button, Chip, Notice } from '@/components/ui';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { weekRange } from '@/lib/dates';
import { count } from '@/lib/format';

/** Week by week, what everyone did: the week in progress first, with live numbers. */
export function WeeklyReportsTab() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { call } = useAuth();
  const [weeks, setWeeks] = useState<WeeklyReportSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setWeeks(await call((token) => api.weeklyReports(token)));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [call]);

  // The week in progress changes all the time: coming back from a report shows its latest numbers.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (!weeks && !error) return <ActivityIndicator color={theme.accent} accessibilityLabel="Loading weekly reports" style={styles.loading} />;

  const zone = weeks?.[0]?.timeZone;
  return (
    <FlatList
      data={weeks ?? []}
      keyExtractor={(week) => week.weekStart}
      contentContainerStyle={[styles.list, { paddingBottom: Spacing.lg + insets.bottom }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor={theme.textSecondary}
          colors={[theme.accent]}
          progressBackgroundColor={theme.surface}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {error && !weeks ? <Button title="Try again" kind="secondary" onPress={() => void load()} /> : null}
          {zone ? (
            <Text style={[styles.intro, { color: theme.textSecondary }]}>
              What each person did, week by week. Weeks run Monday to Sunday, {zone} time.
            </Text>
          ) : null}
        </View>
      }
      ListEmptyComponent={weeks ? <Text style={[styles.intro, { color: theme.textSecondary }]}>Nothing has been recorded yet.</Text> : null}
      renderItem={({ item }) => <WeekRow week={item} />}
    />
  );
}

function WeekRow({ week }: { week: WeeklyReportSummary }) {
  const theme = useTheme();
  const range = weekRange(week.weekStart, week.weekEnd);
  const totals = totalsLine(week.totals);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${range}${week.complete ? '' : ', in progress'}. ${totals.join(', ')}`}
      accessibilityHint="Opens the report for this week"
      onPress={() => router.push({ pathname: '/admin/reports/[weekStart]', params: { weekStart: week.weekStart } })}
      style={({ pressed }) => [styles.row, { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 }]}>
      <View style={styles.rowTop}>
        <Text style={[styles.range, { color: theme.text }]}>{range}</Text>
        {week.complete ? null : <Chip label="In progress" tone="accent" />}
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      </View>
      <View style={styles.totals}>
        {totals.map((total) => (
          <Text key={total} style={[styles.total, { color: theme.textSecondary }]}>
            {total}
          </Text>
        ))}
      </View>
    </Pressable>
  );
}

function totalsLine(totals: WeeklyTotals): string[] {
  return [
    count(totals.activeUsers, 'active person', 'active people'),
    count(totals.messages, 'message'),
    count(totals.uploads, 'upload'),
    count(totals.changesConfirmed, 'change'),
    count(totals.exports, 'download'),
  ];
}

const styles = StyleSheet.create({
  loading: { marginTop: Spacing.xxl },
  list: { padding: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.md },
  header: { gap: Spacing.md },
  intro: { fontSize: 14, lineHeight: 20 },
  row: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  range: { flex: 1, fontSize: 17, fontWeight: '700' },
  totals: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.lg, rowGap: Spacing.xs },
  total: { fontSize: 14 },
});

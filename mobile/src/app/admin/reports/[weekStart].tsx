import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WeeklyReport, WeeklyTotals, WeeklyUserSummary } from '@shared/api';
import { PersonWeekCard } from '@/components/security/PersonWeekCard';
import { Card, Chip, Notice, SectionTitle } from '@/components/ui';
import { MaxContentWidth, Radius, Spacing, useTheme } from '@/constants/theme';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fullDateTime, fullDateTimeIn, weekRange } from '@/lib/dates';
import { fileSize } from '@/lib/format';

/** One week: the totals, then what each person did, most active first. */
export default function WeeklyReportScreen() {
  const { weekStart } = useLocalSearchParams<{ weekStart: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { call } = useAuth();
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setReport(await call((token) => api.weeklyReport(token, weekStart)));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [call, weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function showDownloads(person: WeeklyUserSummary, week: WeeklyReport) {
    router.push({
      pathname: '/admin/security',
      params: { tab: 'downloads', userId: person.user.id, from: week.weekStart, to: week.weekEnd, timeZone: week.timeZone },
    });
  }

  return (
    <>
      <Stack.Screen options={{ title: report ? weekRange(report.weekStart, report.weekEnd) : 'Weekly report' }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Spacing.xxl + insets.bottom }]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {!report ? (
          error ? null : <ActivityIndicator color={theme.accent} style={styles.loading} />
        ) : (
          <>
            <ReportHeader report={report} />
            <Totals totals={report.totals} />
            <SectionTitle>People ({report.users.length})</SectionTitle>
            {report.users.length === 0 ? (
              <Text style={[styles.meta, { color: theme.textSecondary }]}>No one used the assistant this week.</Text>
            ) : (
              <View style={styles.people}>
                {report.users.map((person) => (
                  <PersonWeekCard
                    key={person.user.id}
                    summary={person}
                    timeZone={report.timeZone}
                    onPress={() => showDownloads(person, report)}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

function ReportHeader({ report }: { report: WeeklyReport }) {
  const theme = useTheme();
  return (
    <Card>
      <View style={styles.headerTop}>
        <Text accessibilityRole="header" style={[styles.range, { color: theme.text }]}>
          {weekRange(report.weekStart, report.weekEnd)}
        </Text>
        <Chip label={report.complete ? 'Complete' : 'In progress'} tone={report.complete ? 'neutral' : 'accent'} />
      </View>
      <Text style={[styles.meta, { color: theme.textSecondary }]}>
        Monday to Sunday, {report.timeZone} time.{' '}
        {report.complete
          ? `Generated ${fullDateTimeIn(report.generatedAt, report.timeZone) ?? fullDateTime(report.generatedAt)}.`
          : 'Live numbers: pull down to update them.'}
      </Text>
    </Card>
  );
}

function Totals({ totals }: { totals: WeeklyTotals }) {
  return (
    <View style={styles.totals}>
      <StatTile label="Active people" value={totals.activeUsers.toLocaleString()} />
      <StatTile label="Messages" value={totals.messages.toLocaleString()} />
      <StatTile label="Lookups" value={totals.lookups.toLocaleString()} />
      <StatTile label="Uploads" value={totals.uploads.toLocaleString()} />
      <StatTile label="Changes made" value={totals.changesConfirmed.toLocaleString()} />
      <StatTile label="Sign-ins" value={totals.signIns.toLocaleString()} />
      <StatTile label="Failed sign-ins" value={totals.failedSignIns.toLocaleString()} alarming={totals.failedSignIns > 0} />
      <StatTile label="Downloads" value={totals.exports.toLocaleString()} />
      <StatTile label="Downloaded" value={fileSize(totals.exportedBytes)} />
    </View>
  );
}

function StatTile({ label, value, alarming = false }: { label: string; value: string; alarming?: boolean }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={[styles.tile, { backgroundColor: alarming ? theme.dangerSoft : theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.tileValue, { color: alarming ? theme.danger : theme.text }]}>{value}</Text>
      <Text style={[styles.tileLabel, { color: alarming ? theme.danger : theme.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  loading: { marginTop: Spacing.xxl },
  meta: { fontSize: 13, lineHeight: 18 },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  range: { flex: 1, fontSize: 20, fontWeight: '700' },
  totals: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md },
  tile: { flexGrow: 1, flexBasis: 140, borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md, gap: 2 },
  tileValue: { fontSize: 22, fontWeight: '700' },
  tileLabel: { fontSize: 12, fontWeight: '600' },
  people: { gap: Spacing.md },
});

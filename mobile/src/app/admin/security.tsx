import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { DownloadsTab } from '@/components/security/DownloadsTab';
import { ALL_TIME, type Period } from '@/components/security/periods';
import { WeeklyReportsTab } from '@/components/security/WeeklyReportsTab';
import { SegmentedControl } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';

type Tab = 'downloads' | 'reports';

const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'downloads', label: 'Downloads' },
  { value: 'reports', label: 'Weekly reports' },
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Who downloaded which conversation or file and when, and weekly reports of what everyone did. Opened with `userId`, `from`
 * and `to` (a report's week) and `timeZone` (the report's), it starts on that person's downloads that week.
 */
export default function SecurityScreen() {
  const params = useLocalSearchParams<{ tab?: string; userId?: string; from?: string; to?: string; timeZone?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'reports' ? 'reports' : 'downloads');
  const [initialPeriod] = useState<Period>(() =>
    params.from && params.to && params.timeZone && ISO_DATE.test(params.from) && ISO_DATE.test(params.to)
      ? { kind: 'week', weekStart: params.from, weekEnd: params.to, timeZone: params.timeZone }
      : ALL_TIME,
  );

  // Both tabs stay mounted, so switching keeps each one's search, filters and place in the list.
  return (
    <View style={styles.screen}>
      <View style={styles.tabs}>
        <SegmentedControl label="Security" options={TABS} value={tab} onChange={(next) => setTab(next)} />
      </View>
      <View style={[styles.panel, tab !== 'downloads' && styles.hidden]}>
        <DownloadsTab initialPersonId={params.userId || null} initialPeriod={initialPeriod} />
      </View>
      <View style={[styles.panel, tab !== 'reports' && styles.hidden]}>
        <WeeklyReportsTab />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  tabs: { padding: Spacing.lg, paddingBottom: Spacing.md },
  panel: { flex: 1 },
  hidden: { display: 'none' },
});

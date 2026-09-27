import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { InlineError } from '@/components/chat/InlineError';
import { SearchField } from '@/components/SearchField';
import { Button, Notice } from '@/components/ui';
import { Spacing, useTheme } from '@/constants/theme';
import type { ExportFilters } from '@/lib/api';
import { useDebounced } from '@/lib/debounce';
import { useDownloads, type Downloads } from '@/lib/downloads';
import { DownloadFilters } from './DownloadFilters';
import { DownloadRow } from './DownloadRow';
import { periodFilters, type Period } from './periods';

const SEARCH_DELAY_MS = 350;
const MAX_SEARCH_LENGTH = 200;

/** Every conversation download, newest first: searchable, filtered by person and period, loaded as it scrolls. */
export function DownloadsTab({ initialPersonId, initialPeriod }: { initialPersonId: string | null; initialPeriod: Period }) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const search = useDebounced(text.trim(), SEARCH_DELAY_MS);
  const [personId, setPersonId] = useState(initialPersonId);
  const [period, setPeriod] = useState(initialPeriod);
  // Worked out for each first page, so "Last 7 days" counts back from the latest load or refresh.
  const query = useCallback<() => ExportFilters>(
    () => ({ userId: personId ?? undefined, q: search || undefined, ...periodFilters(period) }),
    [personId, search, period],
  );
  const downloads = useDownloads(query);
  const [refreshing, setRefreshing] = useState(false);
  const filtered = Boolean(personId || search || period.kind !== 'all');

  async function refresh() {
    setRefreshing(true);
    await downloads.refresh();
    setRefreshing(false);
  }

  return (
    <View style={styles.tab}>
      <View style={styles.controls}>
        <SearchField label="Export ID, fingerprint, title or username" value={text} onChangeText={setText} maxLength={MAX_SEARCH_LENGTH} />
        <DownloadFilters personId={personId} onPersonChange={setPersonId} period={period} onPeriodChange={setPeriod} />
      </View>
      <FlatList
        data={downloads.exports ?? []}
        keyExtractor={(entry) => entry.id}
        renderItem={({ item }) => <DownloadRow entry={item} />}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // After a failed page, the next one loads only when the person asks, not on every scroll.
        onEndReached={downloads.moreError ? undefined : downloads.loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={theme.textSecondary}
            colors={[theme.accent]}
            progressBackgroundColor={theme.surface}
          />
        }
        ListHeaderComponent={downloads.error && downloads.exports ? <Notice tone="danger">{downloads.error}</Notice> : null}
        ListEmptyComponent={<ListState downloads={downloads} filtered={filtered} />}
        ListFooterComponent={<MoreState downloads={downloads} />}
      />
    </View>
  );
}

/** What the list shows before it has any downloads: loading, why it failed, or that there are none. */
function ListState({ downloads, filtered }: { downloads: Downloads; filtered: boolean }) {
  const theme = useTheme();
  if (!downloads.exports) {
    return downloads.error ? (
      <View style={styles.state}>
        <Notice tone="danger">{downloads.error}</Notice>
        <Button title="Try again" kind="secondary" onPress={() => void downloads.refresh()} />
      </View>
    ) : (
      <ActivityIndicator color={theme.accent} accessibilityLabel="Loading downloads" style={styles.loading} />
    );
  }
  return (
    <View style={styles.empty}>
      <Ionicons name={filtered ? 'search' : 'download-outline'} size={28} color={theme.textSecondary} />
      <Text style={[styles.emptyTitle, { color: theme.text }]}>{filtered ? 'No matching downloads' : 'No downloads yet'}</Text>
      <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
        {filtered ? 'Try another search, person or period.' : 'When someone shares a conversation, it shows up here.'}
      </Text>
    </View>
  );
}

/** Below the list: the next page loading, why it failed, or that there are no older downloads. */
function MoreState({ downloads }: { downloads: Downloads }) {
  const theme = useTheme();
  if (downloads.loadingMore) return <ActivityIndicator color={theme.accent} accessibilityLabel="Loading older downloads" style={styles.more} />;
  if (downloads.moreError) {
    return (
      <View style={styles.more}>
        <InlineError message={downloads.moreError} onRetry={downloads.loadMore} />
      </View>
    );
  }
  if (!downloads.exports?.length || downloads.hasMore) return null;
  return <Text style={[styles.end, { color: theme.textSecondary }]}>No older downloads.</Text>;
}

const styles = StyleSheet.create({
  tab: { flex: 1 },
  controls: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm, gap: Spacing.sm },
  list: { padding: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.md, flexGrow: 1 },
  state: { gap: Spacing.md, paddingTop: Spacing.lg },
  loading: { marginTop: Spacing.xxl },
  empty: { alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingTop: Spacing.xxl },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyText: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  more: { paddingVertical: Spacing.lg },
  end: { fontSize: 13, textAlign: 'center', paddingVertical: Spacing.md },
});

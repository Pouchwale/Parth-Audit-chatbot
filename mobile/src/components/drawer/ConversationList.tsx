import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ComponentProps } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import type { ConversationSummary } from '@shared/api';
import { Button, Notice } from '@/components/ui';
import { Spacing, useTheme } from '@/constants/theme';
import { useConversations } from '@/lib/conversations';
import { ConversationRow, type ConversationAction } from './ConversationRow';
import { searchConversations, sectionsByDate } from './sections';

export function ConversationList({
  query,
  activeId,
  onOpen,
  onAction,
}: {
  query: string;
  /** The conversation on screen, highlighted in the list. */
  activeId: string | null;
  onOpen(conversationId: string): void;
  onAction(conversation: ConversationSummary, action: ConversationAction): void;
}) {
  const theme = useTheme();
  const { conversations, error, refresh } = useConversations();
  const [pulling, setPulling] = useState(false);

  async function pull() {
    setPulling(true);
    await refresh();
    setPulling(false);
  }

  if (!conversations) return error ? <LoadError message={error} onRetry={refresh} /> : <ListSkeleton />;

  const searching = query.trim().length > 0;
  return (
    <SectionList
      sections={sectionsByDate(searchConversations(conversations, query))}
      keyExtractor={(conversation) => conversation.id}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={pulling}
          onRefresh={pull}
          tintColor={theme.textSecondary}
          colors={[theme.accent]}
          progressBackgroundColor={theme.surface}
        />
      }
      ListHeaderComponent={error ? <Notice tone="danger">{error}</Notice> : null}
      ListEmptyComponent={
        searching ? (
          <EmptyState icon="search" title="No matching chats" text={`Nothing matches “${query.trim()}”.`} />
        ) : (
          <EmptyState icon="chatbubbles-outline" title="No chats yet" text="Your conversations will show up here." />
        )
      }
      renderSectionHeader={({ section }) => (
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => (
        <ConversationRow
          conversation={item}
          active={item.id === activeId}
          onPress={() => onOpen(item.id)}
          onAction={(action) => onAction(item, action)}
        />
      )}
    />
  );
}

const SKELETON_WIDTHS = ['78%', '56%', '84%', '64%', '48%', '72%', '60%'] as const;

/** Placeholder rows the same size as real ones, so nothing jumps when the list arrives. */
function ListSkeleton() {
  const theme = useTheme();
  return (
    <View accessible accessibilityLabel="Loading chats" style={styles.content}>
      <View style={[styles.skeletonHeading, { backgroundColor: theme.surfaceMuted }]} />
      {SKELETON_WIDTHS.map((width, index) => (
        <View key={index} style={styles.skeletonRow}>
          <View style={[styles.skeletonBar, { width, backgroundColor: theme.surfaceMuted }]} />
        </View>
      ))}
    </View>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry(): Promise<void> }) {
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    await onRetry();
    setRetrying(false);
  }

  return (
    <View style={[styles.content, styles.error]}>
      <Notice tone="danger">{message}</Notice>
      <Button title="Try again" kind="secondary" onPress={retry} busy={retrying} />
    </View>
  );
}

function EmptyState({ icon, title, text }: { icon: ComponentProps<typeof Ionicons>['name']; title: string; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={28} color={theme.textSecondary} />
      <Text style={[styles.emptyTitle, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.emptyText, { color: theme.textSecondary }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.sm, paddingBottom: Spacing.lg, flexGrow: 1 },
  sectionTitle: { fontSize: 12, fontWeight: '600', paddingHorizontal: Spacing.md, paddingTop: Spacing.lg, paddingBottom: Spacing.xs },
  skeletonHeading: { width: 64, height: 10, borderRadius: 5, marginLeft: Spacing.md, marginTop: Spacing.lg + 3, marginBottom: Spacing.xs + 3 },
  skeletonRow: { minHeight: 40, justifyContent: 'center', paddingHorizontal: Spacing.md },
  skeletonBar: { height: 12, borderRadius: 6 },
  error: { gap: Spacing.md, paddingTop: Spacing.lg },
  empty: { alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingTop: Spacing.xxl },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyText: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
});

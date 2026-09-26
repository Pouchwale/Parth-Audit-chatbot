import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { AccountSummary } from '@shared/api';
import { Chip, Notice } from '@/components/ui';
import { MaxContentWidth, Radius, Spacing, useTheme } from '@/constants/theme';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { STATUS_LABEL, statusTone, timeAgo } from '@/lib/format';

export default function AccountsScreen() {
  const theme = useTheme();
  const { call } = useAuth();
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setAccounts(await call((token) => api.accounts(token)));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [call]);

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

  if (!accounts && !error) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <FlatList
      data={accounts ?? []}
      keyExtractor={(account) => account.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      ListHeaderComponent={
        error ? (
          <Notice tone="danger">{error}</Notice>
        ) : (
          <Text style={[styles.intro, { color: theme.textSecondary }]}>
            Where each account is signed in right now, and what it last did. Pull down to refresh.
          </Text>
        )
      }
      ListEmptyComponent={<Text style={[styles.intro, { color: theme.textSecondary }]}>No one has signed in yet.</Text>}
      renderItem={({ item }) => <AccountRow account={item} />}
    />
  );
}

function AccountRow({ account }: { account: AccountSummary }) {
  const theme = useTheme();
  const signedIn = account.activeSessions > 0;
  const devices = `${account.activeSessions} ${account.activeSessions === 1 ? 'device' : 'devices'}`;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/admin/[userId]', params: { userId: account.id } })}
      style={({ pressed }) => [styles.row, { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 }]}>
      <View style={styles.rowTop}>
        <View style={styles.flex}>
          <Text style={[styles.name, { color: theme.text }]}>{account.displayName}</Text>
          <Text style={[styles.meta, { color: theme.textSecondary }]}>{account.username}</Text>
        </View>
        {account.role === 'super_admin' ? <Chip label="Super admin" tone="accent" /> : null}
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      </View>

      <View style={styles.presence}>
        <View style={[styles.dot, { backgroundColor: signedIn ? theme.success : theme.border }]} />
        <Text style={[styles.meta, { color: theme.textSecondary }]}>
          {signedIn ? `Signed in on ${devices}` : 'Not signed in'} · Last seen {timeAgo(account.lastSeenAt)}
        </Text>
      </View>

      <View style={[styles.lastAction, { backgroundColor: theme.surfaceMuted }]}>
        {account.lastAction ? (
          <>
            <Text style={[styles.lastLabel, { color: theme.textSecondary }]}>Last action · {timeAgo(account.lastAction.at)}</Text>
            <Text style={[styles.lastSummary, { color: theme.text }]} numberOfLines={2}>
              {account.lastAction.summary}
            </Text>
            <Chip label={STATUS_LABEL[account.lastAction.status]} tone={statusTone(account.lastAction.status)} />
          </>
        ) : (
          <Text style={[styles.meta, { color: theme.textSecondary }]}>No actions yet</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: Spacing.lg, gap: Spacing.md, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  intro: { fontSize: 14, lineHeight: 20, marginBottom: Spacing.xs },
  row: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  flex: { flex: 1 },
  name: { fontSize: 17, fontWeight: '700' },
  meta: { fontSize: 13, lineHeight: 18 },
  presence: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  lastAction: { borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.xs },
  lastLabel: { fontSize: 12, fontWeight: '600' },
  lastSummary: { fontSize: 15, lineHeight: 21 },
});

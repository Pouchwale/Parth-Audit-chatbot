import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AccountDetail, ActionEntry, LoginEntry, SessionEntry } from '@shared/api';
import { Button, Card, Chip, Notice, SectionTitle } from '@/components/ui';
import { MaxContentWidth, Spacing, useTheme } from '@/constants/theme';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useConfirm } from '@/lib/confirm';
import { dateTime, failureLabel, STATUS_LABEL, statusTone, timeAgo } from '@/lib/format';

export default function AccountScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const theme = useTheme();
  const { call } = useAuth();
  const ask = useConfirm();
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [signingOut, setSigningOut] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await call((token) => api.account(token, userId)));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [call, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function signOutDevice(session: SessionEntry) {
    const confirmed = await ask(
      'Sign out this device?',
      `${detail?.account.displayName ?? 'This account'} will be signed out on ${deviceTitle(session)} and will have to sign in again there.`,
      'Sign out',
    );
    if (!confirmed) return;
    setSigningOut(session.id);
    try {
      await call((token) => api.signOutDevice(token, session.id));
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSigningOut(null);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: detail?.account.displayName ?? 'Account' }} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {!detail ? (
          error ? null : <ActivityIndicator color={theme.accent} style={styles.loading} />
        ) : (
          <>
            <Card>
              <View style={styles.itemTop}>
                <Text style={[styles.name, { color: theme.text }]}>{detail.account.displayName}</Text>
                {detail.account.role === 'super_admin' ? <Chip label="Super admin" tone="accent" /> : null}
              </View>
              <Text style={[styles.meta, { color: theme.textSecondary }]}>
                {detail.account.username} · Last seen {timeAgo(detail.account.lastSeenAt)}
              </Text>
            </Card>

            <SectionTitle>Signed in on ({detail.sessions.length})</SectionTitle>
            {detail.sessions.length === 0 ? (
              <Text style={[styles.meta, { color: theme.textSecondary }]}>Not signed in on any device.</Text>
            ) : (
              detail.sessions.map((session) => (
                <DeviceCard key={session.id} session={session} busy={signingOut === session.id} onSignOut={() => signOutDevice(session)} />
              ))
            )}

            <SectionTitle>Recent actions</SectionTitle>
            {detail.recentActions.length === 0 ? (
              <Text style={[styles.meta, { color: theme.textSecondary }]}>No actions yet.</Text>
            ) : (
              detail.recentActions.map((action) => <ActionCard key={action.id} action={action} />)
            )}

            <SectionTitle>Recent sign-ins</SectionTitle>
            {detail.recentLogins.length === 0 ? (
              <Text style={[styles.meta, { color: theme.textSecondary }]}>No sign-ins yet.</Text>
            ) : (
              <Card>
                {detail.recentLogins.map((login) => (
                  <LoginRow key={login.id} login={login} />
                ))}
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

function deviceTitle(session: SessionEntry): string {
  return session.deviceName ?? session.deviceModel ?? 'an unknown device';
}

function DeviceCard({ session, busy, onSignOut }: { session: SessionEntry; busy: boolean; onSignOut(): void }) {
  const theme = useTheme();
  const details = [
    session.deviceName ? session.deviceModel : null,
    [session.os, session.osVersion].filter(Boolean).join(' '),
    session.appVersion ? `App ${session.appVersion}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const movedIp = session.signInIp && session.signInIp !== session.lastIp;
  return (
    <Card style={styles.item}>
      <View style={styles.itemTop}>
        <Ionicons name={session.os?.toLowerCase() === 'web' ? 'desktop-outline' : 'phone-portrait-outline'} size={22} color={theme.accent} />
        <View style={styles.flex}>
          <Text style={[styles.itemTitle, { color: theme.text }]}>{session.deviceName ?? session.deviceModel ?? 'Unknown device'}</Text>
          {details ? <Text style={[styles.meta, { color: theme.textSecondary }]}>{details}</Text> : null}
        </View>
      </View>
      <Text style={[styles.meta, { color: theme.textSecondary }]}>
        IP {session.lastIp ?? 'unknown'}
        {movedIp ? ` (signed in from ${session.signInIp})` : ''}
      </Text>
      <Text style={[styles.meta, { color: theme.textSecondary }]}>
        Signed in {timeAgo(session.signedInAt)} · Last seen {timeAgo(session.lastSeenAt)}
      </Text>
      <Button title="Sign out this device" kind="danger" onPress={onSignOut} busy={busy} />
    </Card>
  );
}

function ActionCard({ action }: { action: ActionEntry }) {
  const theme = useTheme();
  return (
    <Card style={styles.item}>
      <View style={styles.itemTop}>
        <Text style={[styles.itemTitle, styles.flex, { color: theme.text }]}>{action.summary}</Text>
        <Chip label={STATUS_LABEL[action.status]} tone={statusTone(action.status)} />
      </View>
      <Text style={[styles.meta, { color: theme.textSecondary }]}>
        {action.system} · {action.kind === 'write' ? 'Change' : 'Lookup'} · {dateTime(action.at)}
      </Text>
      {action.request ? <Text style={[styles.meta, styles.quote, { color: theme.textSecondary }]}>“{action.request}”</Text> : null}
      {action.error ? <Text style={[styles.meta, { color: theme.danger }]}>{action.error}</Text> : null}
    </Card>
  );
}

function LoginRow({ login }: { login: LoginEntry }) {
  const theme = useTheme();
  const device = login.device;
  const where = [device?.name ?? device?.model, device?.os ? `${device.os} ${device.osVersion ?? ''}`.trim() : null].filter(Boolean).join(' · ');
  return (
    <View style={styles.loginRow}>
      <Ionicons
        name={login.success ? 'checkmark-circle' : 'close-circle'}
        size={20}
        color={login.success ? theme.success : theme.danger}
      />
      <View style={styles.flex}>
        <Text style={[styles.itemTitle, { color: theme.text }]}>{login.success ? 'Signed in' : failureLabel(login.failureReason)}</Text>
        <Text style={[styles.meta, { color: theme.textSecondary }]}>{[login.ip ? `IP ${login.ip}` : null, where].filter(Boolean).join(' · ')}</Text>
      </View>
      <Text style={[styles.meta, { color: theme.textSecondary }]}>{timeAgo(login.at)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  loading: { marginTop: Spacing.xxl },
  name: { fontSize: 20, fontWeight: '700', flexShrink: 1 },
  item: { marginBottom: Spacing.sm },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  itemTitle: { fontSize: 15, fontWeight: '600' },
  flex: { flex: 1 },
  meta: { fontSize: 13, lineHeight: 18 },
  quote: { fontStyle: 'italic' },
  loginRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
});

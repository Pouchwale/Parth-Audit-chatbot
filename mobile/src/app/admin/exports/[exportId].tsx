import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ExportDetail } from '@shared/api';
import { MONOSPACE } from '@/components/chat/CodeBlock';
import { FileActionNotice } from '@/components/files/FileActionNotice';
import { CopyButton } from '@/components/security/CopyButton';
import { DetailRow } from '@/components/security/DetailRow';
import { Avatar, Button, Card, Notice, SectionTitle } from '@/components/ui';
import { MaxContentWidth, Radius, Spacing, useTheme } from '@/constants/theme';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fullDateTime, fullDateTimeIn } from '@/lib/dates';
import { timeZone } from '@/lib/device';
import { useFileActions, type FileTarget } from '@/lib/file-actions';
import { count, downloadKind, fileSize, PURPOSE_LABEL, systemName } from '@/lib/format';

/** Everything recorded about one download, and the file exactly as it was handed out. */
export default function ExportDetailScreen() {
  const { exportId } = useLocalSearchParams<{ exportId: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { call } = useAuth();
  const [detail, setDetail] = useState<ExportDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await call((token) => api.exportDetail(token, exportId)));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [call, exportId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Spacing.xxl + insets.bottom }]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {detail ? <Details detail={detail} /> : error ? null : <ActivityIndicator color={theme.accent} style={styles.loading} />}
    </ScrollView>
  );
}

function Details({ detail }: { detail: ExportDetail }) {
  const theme = useTheme();
  const viewerZone = timeZone();
  const device = detail.device;
  return (
    <>
      <Card style={styles.person}>
        <Avatar name={detail.user.displayName} size={44} />
        <View style={styles.flex}>
          <Text style={[styles.name, { color: theme.text }]}>{detail.user.displayName}</Text>
          <Text style={[styles.meta, { color: theme.textSecondary }]}>{detail.user.username}</Text>
        </View>
      </Card>

      <SectionTitle>What</SectionTitle>
      <Card>
        <DetailRow label="Kind" value={downloadKind(detail)} />
        <DetailRow label="How" value={PURPOSE_LABEL[detail.purpose]} />
      </Card>

      <SectionTitle>When</SectionTitle>
      <Card>
        <DetailRow label={viewerZone ? `Your time (${viewerZone})` : 'Your time'} value={fullDateTime(detail.at)} />
        {detail.timeZone ? (
          <DetailRow
            label={`Their device's time (${detail.timeZone})`}
            value={fullDateTimeIn(detail.at, detail.timeZone) ?? 'This device does not know that time zone.'}
          />
        ) : null}
        <DetailRow label="Recorded (UTC)" value={detail.at} monospace />
      </Card>

      <SectionTitle>Conversation</SectionTitle>
      <Card>
        <DetailRow label="Title when downloaded" value={detail.conversationTitle} />
        {detail.messageCount === null ? null : <DetailRow label="Messages" value={count(detail.messageCount, 'message')} />}
        <DetailRow label="Conversation ID" value={detail.conversationId} monospace copyLabel="Copy conversation ID" />
      </Card>

      <SectionTitle>File</SectionTitle>
      <Card>
        <DetailRow label="File name" value={detail.filename} />
        <DetailRow label="Type" value={detail.mimeType} monospace />
        <DetailRow label="Size" value={fileSize(detail.sizeBytes)} />
        {detail.source ? <DetailRow label="From" value={detail.source} /> : null}
        {detail.fileId ? <DetailRow label="File ID" value={detail.fileId} monospace copyLabel="Copy file ID" /> : null}
        <DetailRow label="Fingerprint (SHA-256)" value={detail.sha256} monospace copyLabel="Copy fingerprint" />
        <DetailRow label="Export ID" value={detail.id} monospace copyLabel="Copy export ID" />
      </Card>

      <SectionTitle>Device</SectionTitle>
      <Card>
        <DetailRow label="Device name" value={device?.name ?? 'Unknown'} />
        <DetailRow label="Model" value={device?.model ?? 'Unknown'} />
        <DetailRow label="System" value={(device && systemName(device)) ?? 'Unknown'} />
        <DetailRow label="App version" value={device?.appVersion ?? 'Unknown'} />
        <DetailRow label="IP address" value={detail.ip ?? 'Unknown'} monospace={Boolean(detail.ip)} />
        <DetailRow label="User agent" value={detail.userAgent ?? 'Unknown'} />
      </Card>

      <SectionTitle>Downloaded file</SectionTitle>
      {detail.content === null ? <RecordedCopy detail={detail} /> : <FileContent filename={detail.filename} content={detail.content} />}
    </>
  );
}

/** The text that was downloaded, exactly: a conversation's. */
function FileContent({ filename, content }: { filename: string; content: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.file, { backgroundColor: theme.surfaceMuted }]}>
      <View style={styles.fileBar}>
        <Text numberOfLines={1} style={[styles.meta, styles.flex, { color: theme.textSecondary }]}>
          {filename}
        </Text>
        <CopyButton text={content} label="Copy the file's content" />
      </View>
      <ScrollView nestedScrollEnabled style={styles.fileScroll} contentContainerStyle={styles.fileContent}>
        <Text selectable style={[styles.code, { color: theme.text }]}>
          {content}
        </Text>
      </ScrollView>
    </View>
  );
}

/** The copy of a file kept with the record, to open. Opening it is recorded too, as the admin's own download. */
function RecordedCopy({ detail }: { detail: ExportDetail }) {
  const theme = useTheme();
  const { call } = useAuth();
  const { state, run, dismiss } = useFileActions();
  const target: FileTarget = {
    key: detail.id,
    filename: detail.filename,
    mimeType: detail.mimeType,
    fetchFile: () => call((token) => api.exportCopy(token, detail.id)),
    recorded: true,
  };
  return (
    <Card>
      <Text style={[styles.explanation, { color: theme.text }]}>
        A copy of the file exactly as it was handed out is kept with this record. Opening it is recorded too, under your
        name.
      </Text>
      <Button title="Open recorded copy" kind="secondary" onPress={() => run('open', target)} busy={state.status === 'busy'} />
      <FileActionNotice state={state} onDismiss={dismiss} />
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  loading: { marginTop: Spacing.xxl },
  person: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  flex: { flex: 1 },
  name: { fontSize: 18, fontWeight: '700' },
  meta: { fontSize: 13, lineHeight: 18 },
  explanation: { fontSize: 14, lineHeight: 20 },
  file: { borderRadius: Radius.md, overflow: 'hidden' },
  fileBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  fileScroll: { maxHeight: 480 },
  fileContent: { padding: Spacing.md },
  code: { fontFamily: MONOSPACE, fontSize: 13, lineHeight: 20 },
});

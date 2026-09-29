import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { FileInfo, FilePurpose } from '@shared/api';
import { FileActionNotice } from '@/components/files/FileActionNotice';
import { FileIcon } from '@/components/files/FileIcon';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { fileTarget, useFileActions } from '@/lib/file-actions';
import { fileKind, KIND_LABEL } from '@/lib/file-types';
import { fileSize } from '@/lib/format';

const ACTIONS: readonly { action: FilePurpose; label: string; icon: ComponentProps<typeof Ionicons>['name'] }[] = [
  { action: 'open', label: 'Open', icon: 'open-outline' },
  { action: 'download', label: 'Download', icon: 'download-outline' },
  { action: 'share', label: 'Share', icon: 'share-outline' },
];

/** A file a connected system returned, such as a report, with Open, Download and Share. */
export function FileCard({ file }: { file: FileInfo }) {
  const theme = useTheme();
  const { call } = useAuth();
  const { state, run, dismiss } = useFileActions();
  const target = fileTarget(file, call);
  const details = [KIND_LABEL[fileKind(file.mimeType)], fileSize(file.sizeBytes), file.system ? `From ${file.system}` : null].filter(Boolean).join(' · ');

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.top} accessible accessibilityLabel={`${file.filename}, ${details}`}>
        <FileIcon mimeType={file.mimeType} size={44} />
        <View style={styles.text}>
          <Text numberOfLines={2} style={[styles.name, { color: theme.text }]}>
            {file.filename}
          </Text>
          <Text numberOfLines={2} style={[styles.details, { color: theme.textSecondary }]}>
            {details}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        {ACTIONS.map(({ action, label, icon }) => {
          const busy = state.status === 'busy' && state.action === action;
          return (
            <Pressable
              key={action}
              accessibilityRole="button"
              accessibilityLabel={`${label} ${file.filename}`}
              aria-busy={busy}
              aria-disabled={state.status === 'busy'}
              disabled={state.status === 'busy'}
              onPress={() => run(action, target)}
              style={({ pressed }) => [
                styles.action,
                { borderColor: theme.border, backgroundColor: pressed ? theme.surfaceMuted : theme.surface, opacity: state.status === 'busy' && !busy ? 0.5 : 1 },
              ]}>
              {busy ? <ActivityIndicator size="small" color={theme.textSecondary} /> : <Ionicons name={icon} size={16} color={theme.text} />}
              <Text style={[styles.actionLabel, { color: theme.text }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <FileActionNotice state={state} onDismiss={dismiss} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.md, marginVertical: Spacing.xs },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  details: { fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  action: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    minHeight: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  actionLabel: { fontSize: 14, fontWeight: '600' },
});

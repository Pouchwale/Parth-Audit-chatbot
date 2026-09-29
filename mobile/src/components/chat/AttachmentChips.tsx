import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FileIcon } from '@/components/files/FileIcon';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import type { Attachment } from '@/lib/attachments';
import { fileKind } from '@/lib/file-types';
import { fileSize } from '@/lib/format';

const PREVIEW_SIZE = 40;
// The overlay dims the preview in both themes, so the spinner on it is always light.
const ON_OVERLAY = '#FFFFFF';

/** The files attached to the message being written, in a row that scrolls sideways. */
export function AttachmentChips({
  items,
  onRemove,
  onRetry,
}: {
  items: readonly Attachment[];
  onRemove(key: string): void;
  onRetry(key: string): void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.row}>
      {items.map((item) => (
        <AttachmentChip key={item.key} attachment={item} onRemove={() => onRemove(item.key)} onRetry={() => onRetry(item.key)} />
      ))}
    </ScrollView>
  );
}

function AttachmentChip({ attachment, onRemove, onRetry }: { attachment: Attachment; onRemove(): void; onRetry(): void }) {
  const theme = useTheme();
  const { picked, status, error, retryable } = attachment;
  const described = describe(attachment);
  const uploading = status === 'waiting' || status === 'uploading';

  return (
    <View
      style={[styles.chip, { backgroundColor: theme.background, borderColor: status === 'failed' ? theme.danger : theme.border }]}
      accessible
      accessibilityLabel={`${picked.name}, ${described}`}
      accessibilityActions={[{ name: 'remove', label: 'Remove' }, ...(status === 'failed' && retryable ? [{ name: 'retry', label: 'Try again' }] : [])]}
      onAccessibilityAction={({ nativeEvent }) => (nativeEvent.actionName === 'retry' ? onRetry() : onRemove())}>
      <View style={styles.preview}>
        {fileKind(picked.mimeType) === 'image' ? <LocalImage source={picked.source} /> : <FileIcon mimeType={picked.mimeType} size={PREVIEW_SIZE} />}
        {uploading ? (
          <View style={[StyleSheet.absoluteFill, styles.previewCover, { backgroundColor: theme.overlay }]}>
            <ActivityIndicator size="small" color={ON_OVERLAY} />
          </View>
        ) : null}
      </View>
      <View style={styles.text}>
        <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.name, { color: theme.text }]}>
          {picked.name}
        </Text>
        <Text numberOfLines={2} style={[styles.status, { color: error ? theme.danger : theme.textSecondary }]}>
          {described}
        </Text>
      </View>
      {status === 'failed' && retryable ? <ChipButton icon="refresh" label={`Try uploading ${picked.name} again`} onPress={onRetry} /> : null}
      <ChipButton icon="close" label={`Remove ${picked.name}`} onPress={onRemove} />
    </View>
  );
}

function describe({ status, error, picked }: Attachment): string {
  switch (status) {
    case 'waiting':
      return 'Waiting to upload…';
    case 'uploading':
      return 'Uploading…';
    case 'uploaded':
      return fileSize(picked.sizeBytes);
    case 'failed':
      return error ?? "Couldn't upload.";
  }
}

/** A picked photo: a file on the phone, or in a browser the file in memory, shown until the chip goes. */
function LocalImage({ source }: { source: string | Blob }) {
  const [uri, setUri] = useState(typeof source === 'string' ? source : null);
  useEffect(() => {
    if (typeof source === 'string') return;
    const url = URL.createObjectURL(source);
    setUri(url);
    return () => URL.revokeObjectURL(url);
  }, [source]);
  return uri ? <Image source={{ uri }} resizeMode="cover" style={styles.image} /> : null;
}

function ChipButton({ icon, label, onPress }: { icon: 'refresh' | 'close'; label: string; onPress(): void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.button, { backgroundColor: pressed ? theme.surfaceMuted : 'transparent' }]}>
      <Ionicons name={icon} size={16} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.sm, paddingBottom: Spacing.sm },
  chip: {
    width: 224,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.xs + 2,
  },
  preview: { width: PREVIEW_SIZE, height: PREVIEW_SIZE, borderRadius: Radius.sm, overflow: 'hidden' },
  previewCover: { alignItems: 'center', justifyContent: 'center' },
  image: { width: PREVIEW_SIZE, height: PREVIEW_SIZE },
  text: { flex: 1, gap: 1 },
  name: { fontSize: 13, fontWeight: '600' },
  status: { fontSize: 12, lineHeight: 16 },
  button: { width: 28, height: 28, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
});

import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { FileInfo } from '@shared/api';
import { FileActionNotice } from '@/components/files/FileActionNotice';
import { FileIcon } from '@/components/files/FileIcon';
import { ImageViewer } from '@/components/files/ImageViewer';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { fileTarget, useFileActions } from '@/lib/file-actions';
import { useFileImage } from '@/lib/file-image';
import { fileKind } from '@/lib/file-types';
import { fileSize } from '@/lib/format';

const THUMBNAIL_SIZE = 96;

/** The files the person attached to a message: photos as thumbnails that open full screen, other files as chips. */
export function MessageAttachments({ files }: { files: readonly FileInfo[] }) {
  const { call } = useAuth();
  const { state, run, dismiss } = useFileActions();
  const images = files.filter((file) => fileKind(file.mimeType) === 'image');
  const others = files.filter((file) => fileKind(file.mimeType) !== 'image');
  const open = (file: FileInfo) => run('open', fileTarget(file, call));

  return (
    <View style={styles.attachments}>
      {images.length > 0 ? (
        <View style={styles.wrap}>
          {images.map((file) => (
            <AttachedImage key={file.id} file={file} onOpenFile={() => open(file)} />
          ))}
        </View>
      ) : null}
      {others.length > 0 ? (
        <View style={styles.wrap}>
          {others.map((file) => (
            <AttachedFile
              key={file.id}
              file={file}
              busy={state.status === 'busy' && state.key === file.id}
              disabled={state.status === 'busy'}
              onPress={() => open(file)}
            />
          ))}
        </View>
      ) : null}
      <FileActionNotice state={state} onDismiss={dismiss} style={styles.notice} />
    </View>
  );
}

/** A photo's thumbnail. One that can't be shown here opens like any other file. */
function AttachedImage({ file, onOpenFile }: { file: FileInfo; onOpenFile(): void }) {
  const theme = useTheme();
  const image = useFileImage(file);
  const [broken, setBroken] = useState(false);
  const [viewing, setViewing] = useState(false);
  const shown = image.status === 'ready' && !broken ? image.source : null;

  return (
    <>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={file.filename}
        accessibilityHint={shown ? 'Shows the photo full screen' : 'Opens the file'}
        disabled={image.status === 'loading'}
        onPress={() => (shown ? setViewing(true) : onOpenFile())}
        style={({ pressed }) => [styles.thumbnail, { backgroundColor: theme.surfaceMuted, opacity: pressed ? 0.85 : 1 }]}>
        {shown ? (
          <Image source={shown} resizeMode="cover" onError={() => setBroken(true)} style={styles.thumbnailImage} />
        ) : image.status === 'loading' ? (
          <ActivityIndicator size="small" color={theme.textSecondary} />
        ) : (
          <FileIcon mimeType={file.mimeType} />
        )}
      </Pressable>
      {viewing && shown ? <ImageViewer name={file.filename} source={shown} onClose={() => setViewing(false)} /> : null}
    </>
  );
}

function AttachedFile({ file, busy, disabled, onPress }: { file: FileInfo; busy: boolean; disabled: boolean; onPress(): void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${file.filename}, ${fileSize(file.sizeBytes)}`}
      accessibilityHint="Opens the file"
      aria-busy={busy}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.file, { backgroundColor: pressed ? theme.surfaceMuted : theme.surface, borderColor: theme.border }]}>
      <FileIcon mimeType={file.mimeType} size={32} />
      <View style={styles.fileText}>
        <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.fileName, { color: theme.text }]}>
          {file.relativePath ?? file.filename}
        </Text>
        <Text style={[styles.fileSize, { color: theme.textSecondary }]}>{fileSize(file.sizeBytes)}</Text>
      </View>
      {busy ? <ActivityIndicator size="small" color={theme.textSecondary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  attachments: { width: '85%', alignSelf: 'flex-end', alignItems: 'flex-end', gap: Spacing.xs },
  notice: { alignSelf: 'stretch' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: Spacing.xs },
  thumbnail: { width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, borderRadius: Radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbnailImage: { width: '100%', height: '100%' },
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    maxWidth: 280,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs + 2,
  },
  fileText: { flexShrink: 1 },
  fileName: { fontSize: 14, fontWeight: '600' },
  fileSize: { fontSize: 12 },
});

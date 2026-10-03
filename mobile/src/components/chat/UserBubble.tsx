import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { FileInfo } from '@shared/api';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { tapFeedback } from '@/lib/haptics';
import { Action } from './MessageActions';
import { MessageAttachments } from './MessageAttachments';
import { MessageEditor } from './MessageEditor';
import { useCopy } from './useCopy';

const COPY_ACTION = [{ name: 'copy', label: 'Copy' }];
const STILL_ANSWERING = 'Mitra is still answering. Stop it or wait, then edit.';
const HINT_SHOWN_MS = 4000;

/** How a sent message can be changed. Missing when it can't be, e.g. one that was never sent. */
export interface EditControls {
  /** The editor is open on this message. */
  editing: boolean;
  /** Mitra is answering: the pen is off, and says so when tapped. */
  busy: boolean;
  /** What came after this message made changes in DCRS, which stay made. */
  madeChanges: boolean;
  onStart(): void;
  onCancel(): void;
  onSave(text: string): void;
}

/**
 * Something the person said, right-aligned in a bubble, under the files they attached, with Copy and a pen to change
 * it beneath. A long press copies it too. With the pen tapped, the bubble becomes an editor.
 */
export function UserBubble({
  text,
  attachments,
  editedAt,
  edit,
  faded = false,
}: {
  text: string;
  attachments?: readonly FileInfo[];
  /** When the words were last changed; missing on a message never edited. */
  editedAt?: string;
  edit?: EditControls;
  faded?: boolean;
}) {
  const theme = useTheme();
  const { copied, copy } = useCopy();
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(hintTimer.current), []);

  function copyText() {
    tapFeedback();
    copy(text);
  }

  function startEdit() {
    if (!edit) return;
    if (edit.busy) {
      setHint(STILL_ANSWERING);
      clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setHint(null), HINT_SHOWN_MS);
      return;
    }
    setHint(null);
    tapFeedback();
    edit.onStart();
  }

  if (edit?.editing) {
    return (
      <View style={styles.message}>
        {attachments && attachments.length > 0 ? <MessageAttachments files={attachments} /> : null}
        <MessageEditor initial={text} madeChanges={edit.madeChanges} busy={edit.busy} onCancel={edit.onCancel} onSave={edit.onSave} />
      </View>
    );
  }

  return (
    <View style={[styles.message, { opacity: faded ? 0.6 : 1 }]}>
      {attachments && attachments.length > 0 ? <MessageAttachments files={attachments} /> : null}
      <View style={styles.row}>
        <Pressable
          onLongPress={copyText}
          accessibilityHint="Long press to copy"
          accessibilityActions={COPY_ACTION}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === 'copy') copyText();
          }}
          style={[styles.bubble, { backgroundColor: theme.surfaceMuted }]}>
          {/* Selecting text would take over the long press on phones; browsers select with the mouse instead. */}
          <Text selectable={Platform.OS === 'web'} style={[styles.text, { color: theme.text }]}>
            {text}
          </Text>
        </Pressable>
      </View>
      {edit ? (
        <View style={styles.actions}>
          {editedAt ? <Text style={[styles.edited, { color: theme.textSecondary }]}>Edited</Text> : null}
          <Action icon={copied ? 'checkmark' : 'copy-outline'} label={copied ? 'Copied' : 'Copy'} onPress={copyText} />
          <Action
            icon="pencil-outline"
            label="Edit"
            accessibilityLabel="Edit message"
            accessibilityHint={edit.busy ? STILL_ANSWERING : 'Changes the words and asks again'}
            off={edit.busy}
            onPress={startEdit}
          />
        </View>
      ) : null}
      {hint ? (
        <Text style={[styles.hint, { color: theme.textSecondary }]} accessibilityLiveRegion="polite">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  message: { gap: Spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: Spacing.sm },
  bubble: { maxWidth: '85%', borderRadius: Radius.lg + 2, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm + 2 },
  text: { fontSize: 16, lineHeight: 24 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: Spacing.xs, marginRight: -Spacing.sm, marginTop: -Spacing.sm, marginBottom: -Spacing.xs },
  edited: { fontSize: 12, marginRight: Spacing.xs },
  hint: { fontSize: 13, lineHeight: 18, textAlign: 'right' },
});

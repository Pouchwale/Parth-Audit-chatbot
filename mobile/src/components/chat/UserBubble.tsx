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
  /** Why the last change to this message wasn't saved, if it wasn't. */
  error: string | null;
  /** The words typed so far into the editor, or null when it has only just opened. */
  draft: string | null;
  /** The editor's box takes the keyboard's focus when drawn: only when the pen was just tapped. */
  focus: boolean;
  /** The chat is the screen in front, so the phone's back button closes the editor. */
  inFront: boolean;
  onStart(): void;
  onCancel(): void;
  onSave(text: string): void;
  /** The words in the editor changed. */
  onChange(text: string): void;
  /** The editor's box gained (true) or lost (false) the keyboard's focus. */
  onFocusChange(focused: boolean): void;
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
        <MessageEditor
          original={text}
          draft={edit.draft}
          error={edit.error}
          madeChanges={edit.madeChanges}
          busy={edit.busy}
          focus={edit.focus}
          inFront={edit.inFront}
          onChange={edit.onChange}
          onFocusChange={edit.onFocusChange}
          onCancel={edit.onCancel}
          onSave={edit.onSave}
        />
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
      {/* Only while Mitra is still answering: once it has finished, the pen works again and the hint would mislead. */}
      {hint && edit?.busy ? (
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

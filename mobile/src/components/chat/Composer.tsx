import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Radius, Spacing, useColorSchemeSetting, useTheme } from '@/constants/theme';
import type { Attachments } from '@/lib/attachments';
import { MAX_MESSAGE_LENGTH } from '@/lib/chat-stream';
import type { VoiceInput } from '@/lib/voice';
import { AttachMenu, type Anchor } from './AttachMenu';
import { AttachmentChips } from './AttachmentChips';
import { ComposerButton } from './ComposerButton';
import { RecordingBar } from './RecordingBar';

const LINE_HEIGHT = 22;
const INPUT_PADDING = 7;
const MIN_INPUT_HEIGHT = LINE_HEIGHT + 2 * INPUT_PADDING;
const MAX_INPUT_HEIGHT = 6 * LINE_HEIGHT + 2 * INPUT_PADDING;
// Safari reports a key taken by an input method (IME) with this code, rather than with isComposing.
const IME_KEY_CODE = 229;

/**
 * The message box: grows to six lines, then scrolls. On the left, the button that attaches photos and files, which
 * show above the text as they upload. On the right, the microphone when there is no text, Send when there is
 * something to send, and Stop while a reply is being written. Recording replaces the box with its own bar.
 */
export function Composer({
  value,
  onChangeText,
  onSend,
  onStop,
  busy,
  stopping,
  disabled,
  voice,
  sendsVoice,
  attachments,
}: {
  value: string;
  onChangeText(text: string): void;
  onSend(): void;
  onStop(): void;
  /** A reply is being written. */
  busy: boolean;
  /** Stop was pressed, and takes effect once the reply has started. */
  stopping: boolean;
  /** Nothing can be sent yet, e.g. while the conversation loads. */
  disabled: boolean;
  voice: VoiceInput;
  /** A finished recording is sent straight away rather than put in the box. */
  sendsVoice: boolean;
  attachments: Attachments;
}) {
  const theme = useTheme();
  const scheme = useColorSchemeSetting();
  const [focused, setFocused] = useState(false);
  const [webHeight, setWebHeight] = useState(MIN_INPUT_HEIGHT);
  const [menu, setMenu] = useState<{ open: boolean; anchor: Anchor | null }>({ open: false, anchor: null });
  const attachButton = useRef<View>(null);
  const hasText = value.trim().length > 0;
  const tooLong = value.trim().length > MAX_MESSAGE_LENGTH;
  const hasFiles = attachments.items.length > 0;

  function openMenu() {
    // Phones show the menu as a sheet; browsers show it beside the button, so it is measured first.
    if (Platform.OS !== 'web') return setMenu({ open: true, anchor: null });
    attachButton.current?.measureInWindow((x, y) => setMenu({ open: true, anchor: { x, y } }));
  }

  function renderContent() {
    if (voice.phase === 'recording') {
      return (
        <RecordingBar
          elapsedMs={voice.elapsedMs}
          levels={voice.levels}
          doneLabel={sendsVoice ? 'Finish and send' : 'Finish recording'}
          onCancel={voice.cancel}
          onDone={voice.finish}
        />
      );
    }
    if (voice.phase === 'transcribing') {
      return (
        <View style={styles.transcribing} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={theme.textSecondary} />
          <Text style={[styles.transcribingText, { color: theme.textSecondary }]}>Transcribing…</Text>
        </View>
      );
    }
    return (
      <>
        <View ref={attachButton} collapsable={false}>
          <ComposerButton icon="add" label="Add attachment" onPress={openMenu} disabled={disabled} />
        </View>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="Message Assistant…"
          placeholderTextColor={theme.textSecondary}
          accessibilityLabel="Message"
          multiline
          submitBehavior="submit"
          returnKeyType="send"
          onSubmitEditing={onSend}
          onKeyPress={(event) => {
            // Web: Enter sends and Shift+Enter starts a new line. Phones use the keyboard's send key. An Enter that
            // picks a word in an input method (IME) is still typing.
            const key = event.nativeEvent as { key: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number };
            if (Platform.OS === 'web' && key.key === 'Enter' && !key.shiftKey && !key.isComposing && key.keyCode !== IME_KEY_CODE) {
              event.preventDefault();
              onSend();
            }
          }}
          // Phones grow the box by themselves. Browsers report only growth, so it shrinks back once sent.
          onContentSizeChange={
            Platform.OS === 'web'
              ? ({ nativeEvent }) => setWebHeight(Math.min(MAX_INPUT_HEIGHT, Math.max(MIN_INPUT_HEIGHT, nativeEvent.contentSize.height)))
              : undefined
          }
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardAppearance={scheme}
          style={[styles.input, { color: theme.text }, Platform.OS === 'web' ? { height: value ? webHeight : MIN_INPUT_HEIGHT } : null]}
        />
        {busy ? (
          <ComposerButton icon="stop" label={stopping ? 'Stopping the reply' : 'Stop the reply'} onPress={onStop} primary busy={stopping} />
        ) : (
          <>
            {hasText ? null : (
              <ComposerButton
                icon="mic"
                label="Record a voice message"
                onPress={voice.start}
                busy={voice.phase === 'starting'}
                disabled={disabled}
              />
            )}
            {hasText || hasFiles ? (
              <ComposerButton
                icon="arrow-up"
                label={attachments.ready ? 'Send message' : 'Send message, once the files have uploaded'}
                onPress={onSend}
                primary
                disabled={disabled || tooLong || !attachments.ready}
              />
            ) : null}
          </>
        )}
      </>
    );
  }

  return (
    <View style={styles.container}>
      {voice.problem ? <Problem text={voice.problem} onDismiss={voice.dismissProblem} /> : null}
      {attachments.notice ? <Problem text={attachments.notice} onDismiss={attachments.dismissNotice} /> : null}
      {tooLong ? <Problem text={`Messages can be up to ${MAX_MESSAGE_LENGTH.toLocaleString()} characters. Shorten this one to send it.`} /> : null}
      <View style={[styles.box, { backgroundColor: theme.surface, borderColor: focused ? theme.textSecondary : theme.border }]}>
        {hasFiles ? <AttachmentChips items={attachments.items} onRemove={attachments.remove} onRetry={attachments.retry} /> : null}
        {attachments.reading ? (
          <View style={styles.reading} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={theme.textSecondary} />
            <Text style={[styles.readingText, { color: theme.textSecondary }]}>Reading the folder…</Text>
          </View>
        ) : null}
        <View style={styles.row}>{renderContent()}</View>
      </View>
      <AttachMenu
        visible={menu.open}
        anchor={menu.anchor}
        onPick={attachments.pick}
        onClose={() => setMenu((current) => ({ ...current, open: false }))}
      />
    </View>
  );
}

/** Something about the message to put right, above the box. */
function Problem({ text, onDismiss }: { text: string; onDismiss?: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.problem, { backgroundColor: theme.warningSoft }]} accessibilityLiveRegion="polite">
      <Text style={[styles.problemText, { color: theme.warning }]}>{text}</Text>
      {onDismiss ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onDismiss} hitSlop={8}>
          <Ionicons name="close" size={18} color={theme.warning} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: Spacing.md, paddingTop: Spacing.xs, paddingBottom: Spacing.sm, gap: Spacing.sm },
  box: {
    borderRadius: Radius.lg + 6,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.xs, minHeight: MIN_INPUT_HEIGHT },
  input: {
    flex: 1,
    minHeight: MIN_INPUT_HEIGHT,
    maxHeight: MAX_INPUT_HEIGHT,
    paddingTop: INPUT_PADDING,
    paddingBottom: INPUT_PADDING,
    paddingHorizontal: 0,
    fontSize: 16,
    lineHeight: LINE_HEIGHT,
    // The box shows focus with its border instead. Browsers draw an "auto" outline whatever its width.
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  transcribing: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: MIN_INPUT_HEIGHT, paddingLeft: Spacing.sm },
  transcribingText: { fontSize: 16 },
  reading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.sm, paddingBottom: Spacing.sm },
  readingText: { fontSize: 14 },
  problem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  problemText: { flex: 1, fontSize: 14, lineHeight: 20 },
});

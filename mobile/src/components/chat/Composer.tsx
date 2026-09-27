import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Radius, Spacing, useColorSchemeSetting, useTheme } from '@/constants/theme';
import { MAX_MESSAGE_LENGTH } from '@/lib/chat-stream';
import type { VoiceInput } from '@/lib/voice';
import { ComposerButton } from './ComposerButton';
import { RecordingBar } from './RecordingBar';

const LINE_HEIGHT = 22;
const INPUT_PADDING = 7;
const MIN_INPUT_HEIGHT = LINE_HEIGHT + 2 * INPUT_PADDING;
const MAX_INPUT_HEIGHT = 6 * LINE_HEIGHT + 2 * INPUT_PADDING;
// Safari reports a key taken by an input method (IME) with this code, rather than with isComposing.
const IME_KEY_CODE = 229;

/**
 * The message box: grows to six lines, then scrolls. On the right, Send when there is text, the microphone
 * when there isn't, and Stop while a reply is being written. Recording replaces the box with its own bar.
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
}) {
  const theme = useTheme();
  const scheme = useColorSchemeSetting();
  const [focused, setFocused] = useState(false);
  const [webHeight, setWebHeight] = useState(MIN_INPUT_HEIGHT);
  const tooLong = value.trim().length > MAX_MESSAGE_LENGTH;

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
        ) : value.trim() ? (
          <ComposerButton icon="arrow-up" label="Send message" onPress={onSend} primary disabled={disabled || tooLong} />
        ) : (
          <ComposerButton
            icon="mic"
            label="Record a voice message"
            onPress={voice.start}
            busy={voice.phase === 'starting'}
            disabled={disabled}
          />
        )}
      </>
    );
  }

  return (
    <View style={styles.container}>
      {voice.problem ? (
        <View style={[styles.problem, { backgroundColor: theme.warningSoft }]} accessibilityLiveRegion="polite">
          <Text style={[styles.problemText, { color: theme.warning }]}>{voice.problem}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={voice.dismissProblem} hitSlop={8}>
            <Ionicons name="close" size={18} color={theme.warning} />
          </Pressable>
        </View>
      ) : null}
      {tooLong ? (
        <View style={[styles.problem, { backgroundColor: theme.warningSoft }]} accessibilityLiveRegion="polite">
          <Text style={[styles.problemText, { color: theme.warning }]}>
            {`Messages can be up to ${MAX_MESSAGE_LENGTH.toLocaleString()} characters. Shorten this one to send it.`}
          </Text>
        </View>
      ) : null}
      <View style={[styles.box, { backgroundColor: theme.surface, borderColor: focused ? theme.textSecondary : theme.border }]}>
        {renderContent()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: Spacing.md, paddingTop: Spacing.xs, paddingBottom: Spacing.sm, gap: Spacing.sm },
  box: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.xs,
    minHeight: MIN_INPUT_HEIGHT + 2 * Spacing.sm,
    borderRadius: Radius.lg + 6,
    borderWidth: 1,
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
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
  transcribing: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: MIN_INPUT_HEIGHT },
  transcribingText: { fontSize: 16 },
  problem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  problemText: { flex: 1, fontSize: 14, lineHeight: 20 },
});

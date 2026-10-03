import { useEffect, useState } from 'react';
import { BackHandler, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui';
import { Radius, Spacing, useColorSchemeSetting, useTheme } from '@/constants/theme';
import { MAX_MESSAGE_LENGTH } from '@/lib/chat-stream';
import { AUTO_SIZE_STYLE, REPORTS_CONTENT_SIZE } from './auto-size';

const LINE_HEIGHT = 22;
const INPUT_PADDING = 8;
const MIN_INPUT_HEIGHT = 2 * LINE_HEIGHT + 2 * INPUT_PADDING;
const MAX_INPUT_HEIGHT = 8 * LINE_HEIGHT + 2 * INPUT_PADDING;

/** Said once in the editor when the replies being replaced made changes in DCRS: editing does not undo them. */
export const CHANGES_STAY = 'Changes already made in DCRS stay as they are.';

/**
 * A message the person sent, open for changing its words, in place of its bubble. Save is off while the words are
 * empty, unchanged or too long, and while Mitra is answering. The phone's back button and Escape close it.
 *
 * The words typed are kept outside it (onChange), so that it starts from them when it is drawn again: scrolled back
 * into view, or opened again on words that weren't saved, with why.
 */
export function MessageEditor({
  original,
  draft,
  error,
  madeChanges,
  busy,
  focus,
  inFront,
  onChange,
  onFocusChange,
  onCancel,
  onSave,
}: {
  /** The words as sent. */
  original: string;
  /** Words typed before this editor was drawn, or null when there are none. */
  draft: string | null;
  /** Why the last change wasn't saved, if it wasn't. */
  error: string | null;
  /** What came after this message made changes in DCRS, which stay made. */
  madeChanges: boolean;
  /** Mitra is answering, so nothing can be saved yet. */
  busy: boolean;
  /** Take the keyboard's focus when drawn: only when the pen was just tapped. */
  focus: boolean;
  /** The chat is the screen in front, so the phone's back button is the editor's. */
  inFront: boolean;
  onChange(text: string): void;
  onFocusChange(focused: boolean): void;
  onCancel(): void;
  onSave(text: string): void;
}) {
  const theme = useTheme();
  const scheme = useColorSchemeSetting();
  const [text, setText] = useState(() => draft ?? original);
  const [webHeight, setWebHeight] = useState(MIN_INPUT_HEIGHT);
  const trimmed = text.trim();
  const tooLong = trimmed.length > MAX_MESSAGE_LENGTH;
  const canSave = trimmed.length > 0 && trimmed !== original.trim() && !tooLong && !busy;

  // Android's back button closes the editor instead of leaving the chat, but only while the chat is in front: with
  // another screen or the menu over it, back is theirs. Browsers and iPhones have no such button.
  useEffect(() => {
    if (!inFront) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel();
      return true;
    });
    return () => subscription.remove();
  }, [inFront, onCancel]);

  function change(value: string) {
    setText(value);
    onChange(value);
  }

  function save() {
    if (canSave) onSave(trimmed);
  }

  return (
    <View style={[styles.editor, { backgroundColor: theme.surface, borderColor: theme.accent }]}>
      <TextInput
        value={text}
        onChangeText={change}
        accessibilityLabel="Edit message"
        autoFocus={focus}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        multiline
        submitBehavior="newline"
        placeholder="Your message"
        placeholderTextColor={theme.textSecondary}
        keyboardAppearance={scheme}
        onKeyPress={(event) => {
          if (event.nativeEvent.key === 'Escape') onCancel();
        }}
        // Phones, and browsers with field-sizing, grow the box by themselves. Other browsers report only growth, so
        // the height is kept here.
        onContentSizeChange={
          REPORTS_CONTENT_SIZE
            ? ({ nativeEvent }) => setWebHeight(Math.min(MAX_INPUT_HEIGHT, Math.max(MIN_INPUT_HEIGHT, nativeEvent.contentSize.height)))
            : undefined
        }
        style={[styles.input, { color: theme.text }, AUTO_SIZE_STYLE, REPORTS_CONTENT_SIZE ? { height: webHeight } : null]}
      />
      {error ? (
        <Text style={[styles.note, { color: theme.danger }]} accessibilityLiveRegion="polite">
          {`Your change wasn't saved. ${error}`}
        </Text>
      ) : null}
      {tooLong ? (
        <Text style={[styles.note, { color: theme.warning }]} accessibilityLiveRegion="polite">
          Messages can be up to {MAX_MESSAGE_LENGTH.toLocaleString()} characters. Shorten this one to save it.
        </Text>
      ) : null}
      {busy ? <Text style={[styles.note, { color: theme.textSecondary }]}>Mitra is still answering. Stop it or wait, then save.</Text> : null}
      {madeChanges ? <Text style={[styles.note, { color: theme.textSecondary }]}>{CHANGES_STAY}</Text> : null}
      <View style={styles.buttons}>
        <Button title="Cancel" kind="secondary" onPress={onCancel} style={styles.button} />
        <Button title="Save" onPress={save} disabled={!canSave} style={styles.button} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  editor: { alignSelf: 'stretch', borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  input: {
    minHeight: MIN_INPUT_HEIGHT,
    maxHeight: MAX_INPUT_HEIGHT,
    paddingVertical: INPUT_PADDING,
    paddingHorizontal: 0,
    fontSize: 16,
    lineHeight: LINE_HEIGHT,
    // The box shows focus with its border instead. Browsers draw an "auto" outline whatever its width.
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  note: { fontSize: 13, lineHeight: 18 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm },
  button: { minHeight: 40, minWidth: 88 },
});

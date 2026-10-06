import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native';
import type { ChatMessage } from '@shared/api';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { AssistantResponse } from './AssistantResponse';
import { useChatControls } from './chat-controls';
import { UserBubble } from './UserBubble';

/** Further than this from the latest message, the person is reading back and the list stops following. */
const AWAY_PX = 120;

// Many browsers keep the reader's place by themselves ("scroll anchoring"), which together with the list's own
// adjustment would move it twice as far. Phones and some browsers don't, so the list does it itself everywhere.
const LIST_STYLE: ViewStyle & { overflowAnchor?: 'none' } = Platform.OS === 'web' ? { overflowAnchor: 'none' } : {};

// How much of the conversation is drawn: the screen and two screens either side (the default is ten either side),
// in small batches, so opening a long conversation draws what shows and little more.
const INITIAL_ROWS = 10;
const ROWS_PER_BATCH = 5;
const WINDOW_SCREENS = 5;

const keyOf = (message: ChatMessage) => message.id;

/**
 * The conversation, newest at the bottom. It follows a reply as it streams in, unless the person has scrolled
 * up to read, in which case it keeps their place and offers a button back to the latest message.
 */
export function MessageList({
  messages,
  busy,
  editingId,
  footer,
}: {
  messages: readonly ChatMessage[];
  /** A request is running: sending one brings the latest message into view. */
  busy: boolean;
  /** The message whose editor is open. */
  editingId: string | null;
  /** Shown below the last message. */
  footer: ReactElement | null;
}) {
  const theme = useTheme();
  const list = useRef<FlatList<ChatMessage>>(null);
  // Inverted: offset 0 is the bottom of the conversation, and it grows as the person scrolls up.
  const offset = useRef(0);
  const newest = useRef<{ id: string; height: number } | null>(null);
  const [away, setAway] = useState(false);
  /** The message whose editor box has the keyboard's focus. */
  const focusedEditor = useRef<string | null>(null);
  /** The height of the row whose editor is open, as last laid out. */
  const editorRow = useRef<{ id: string; height: number } | null>(null);
  const listHeight = useRef(0);

  // Jumps rather than scrolls: an animation would be interrupted by the reply growing underneath it.
  function showLatest() {
    offset.current = 0;
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }

  useEffect(() => {
    if (busy) showLatest();
  }, [busy]);

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    offset.current = event.nativeEvent.contentOffset.y;
    const isAway = offset.current > AWAY_PX;
    if (isAway === away) return;
    // Measuring starts afresh each time the person scrolls away: the first measurement is a size, not growth.
    if (isAway) newest.current = null;
    setAway(isAway);
  }

  // A streaming reply grows at offset 0, pushing everything above it up the screen. While the person reads
  // further up, the list moves with it to keep their place. Only the newest message is measured: other
  // changes in height, such as older messages being drawn as they scroll into view, don't move the place.
  function onNewestLayout(id: string, event: LayoutChangeEvent) {
    const { height } = event.nativeEvent.layout;
    const grown = newest.current?.id === id ? height - newest.current.height : 0;
    newest.current = { id, height };
    if (grown === 0 || offset.current <= AWAY_PX) return;
    offset.current += grown;
    list.current?.scrollToOffset({ offset: offset.current, animated: false });
  }

  // Newest first, as the inverted list wants it. Rows take what else they need from the chat's controls, so this
  // and the row renderer stay the same while a reply streams in, and only the row whose message changed is drawn.
  const data = [...messages].reverse();

  function onEditorFocus(messageId: string, focused: boolean) {
    if (focused) focusedEditor.current = messageId;
    else if (focusedEditor.current === messageId) focusedEditor.current = null;
  }

  // When the list gets shorter while an editor has the keyboard (the keyboard opening, or the window shrinking), the
  // editor is brought down to just above it, so that its words and Save stay on the screen. When the whole editor
  // can't fit there (a phone on its side), its top is shown instead, where the words are: Save is then a scroll away,
  // and back in view once the keyboard closes.
  function onListLayout(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout.height;
    const shrank = next < listHeight.current - 1;
    listHeight.current = next;
    const id = focusedEditor.current;
    if (!shrank || id === null || id !== editingId) return;
    const index = data.findIndex((message) => message.id === id);
    if (index < 0) return;
    const height = editorRow.current?.id === id ? editorRow.current.height : 0;
    const fits = height + Spacing.md <= next;
    list.current?.scrollToIndex({ index, viewPosition: fits ? 0 : 1, viewOffset: fits ? Spacing.md : 0, animated: true });
  }

  function onRowLayout(id: string, newestAway: boolean, event: LayoutChangeEvent) {
    if (id === editingId) editorRow.current = { id, height: event.nativeEvent.layout.height };
    if (newestAway) onNewestLayout(id, event);
  }

  // Only two rows are measured: the newest while the person reads further up (measuring costs the browser a layout
  // each time the reply grows, and nothing is done with it while the list follows the reply anyway), and the one
  // whose editor is open. Each is measured by a sensor laid over it, which is drawn only while it is needed: a row
  // drawn without a size handler never reports its size in a browser, even once it is given one, since the browser
  // build starts watching a view's size only when the view is first drawn.
  function renderItem({ item, index }: ListRenderItemInfo<ChatMessage>) {
    const isNewest = index === 0;
    const newestAway = isNewest && away;
    const measured = newestAway || item.id === editingId;
    return (
      <View>
        <MessageRow message={item} isNewest={isNewest} onEditorFocus={onEditorFocus} />
        {measured ? <View style={styles.sensor} onLayout={(event) => onRowLayout(item.id, newestAway, event)} /> : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        ref={list}
        inverted
        data={data}
        keyExtractor={keyOf}
        renderItem={renderItem}
        ListHeaderComponent={footer}
        initialNumToRender={INITIAL_ROWS}
        maxToRenderPerBatch={ROWS_PER_BATCH}
        windowSize={WINDOW_SCREENS}
        style={LIST_STYLE}
        contentContainerStyle={styles.content}
        onScroll={onScroll}
        onLayout={onListLayout}
        // A row not drawn yet has no place to scroll to: the nearest guess will do.
        onScrollToIndexFailed={({ index, averageItemLength }) => list.current?.scrollToOffset({ offset: index * averageItemLength, animated: true })}
        scrollEventThrottle={32}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      />
      {away ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scroll to the latest message"
          onPress={showLatest}
          style={({ pressed }) => [
            styles.jump,
            { backgroundColor: pressed ? theme.surfaceMuted : theme.surface, borderColor: theme.border },
          ]}>
          <Ionicons name="arrow-down" size={18} color={theme.text} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** One message of the conversation, drawn from its message and the chat's controls. */
function MessageRow({
  message,
  isNewest,
  onEditorFocus,
}: {
  message: ChatMessage;
  isNewest: boolean;
  onEditorFocus(messageId: string, focused: boolean): void;
}) {
  const controls = useChatControls();
  if (message.role === 'user') {
    const editing = controls.editing?.id === message.id ? controls.editing : null;
    return (
      <UserBubble
        text={message.text}
        attachments={message.attachments}
        editedAt={message.editedAt}
        edit={{
          editing: editing !== null,
          busy: controls.busy,
          madeChanges: editing?.madeChanges ?? false,
          error: editing?.error ?? null,
          // Read as the editor is drawn: typing keeps the words without drawing anything.
          draft: editing ? controls.draftOf(message.id) : null,
          focus: editing?.focus ?? false,
          inFront: controls.inFront,
          onStart: () => controls.startEdit(message.id),
          onCancel: controls.cancelEdit,
          onSave: (text) => controls.saveEdit(message.id, text),
          onChange: (text) => controls.keepDraft(message.id, text),
          onFocusChange: (focused) => {
            if (focused) controls.editorFocused();
            onEditorFocus(message.id, focused);
          },
        }}
      />
    );
  }
  const streaming = message.status === 'streaming';
  const retryable = !controls.busy && isNewest && message.status === 'error';
  return (
    <AssistantResponse
      message={message}
      answerableId={controls.answerableId}
      deciding={controls.deciding}
      busy={controls.busy}
      reading={controls.reading === message.id}
      unvoiced={controls.voiceNote?.messageId === message.id ? controls.voiceNote.language : null}
      waiting={streaming && isNewest ? controls.waiting : null}
      onDecide={controls.decide}
      onRetry={retryable ? controls.retry : undefined}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  /** Laid over a row to measure it, without taking touches. */
  sensor: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, pointerEvents: 'none' },
  content: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.lg, gap: Spacing.xl },
  jump: {
    position: 'absolute',
    bottom: Spacing.md,
    alignSelf: 'center',
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native';
import type { ChatMessage } from '@shared/api';
import { Radius, Spacing, useTheme } from '@/constants/theme';

/** Further than this from the latest message, the person is reading back and the list stops following. */
const AWAY_PX = 120;

// Many browsers keep the reader's place by themselves ("scroll anchoring"), which together with the list's own
// adjustment would move it twice as far. Phones and some browsers don't, so the list does it itself everywhere.
const LIST_STYLE: ViewStyle & { overflowAnchor?: 'none' } = Platform.OS === 'web' ? { overflowAnchor: 'none' } : {};

/**
 * The conversation, newest at the bottom. It follows a reply as it streams in, unless the person has scrolled
 * up to read, in which case it keeps their place and offers a button back to the latest message.
 */
export function MessageList({
  messages,
  busy,
  footer,
  renderMessage,
}: {
  messages: readonly ChatMessage[];
  /** A request is running: sending one brings the latest message into view. */
  busy: boolean;
  /** Shown below the last message. */
  footer: ReactElement | null;
  renderMessage(message: ChatMessage): ReactElement;
}) {
  const theme = useTheme();
  const list = useRef<FlatList<ChatMessage>>(null);
  // Inverted: offset 0 is the bottom of the conversation, and it grows as the person scrolls up.
  const offset = useRef(0);
  const newest = useRef<{ id: string; height: number } | null>(null);
  const [away, setAway] = useState(false);

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
    if (isAway !== away) setAway(isAway);
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

  const newestId = messages.at(-1)?.id;

  return (
    <View style={styles.container}>
      <FlatList
        ref={list}
        inverted
        data={[...messages].reverse()}
        keyExtractor={(message) => message.id}
        renderItem={({ item }) => (
          <View onLayout={item.id === newestId ? (event) => onNewestLayout(item.id, event) : undefined}>{renderMessage(item)}</View>
        )}
        ListHeaderComponent={footer}
        style={LIST_STYLE}
        contentContainerStyle={styles.content}
        onScroll={onScroll}
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

const styles = StyleSheet.create({
  container: { flex: 1 },
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

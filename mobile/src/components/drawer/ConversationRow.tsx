import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ConversationSummary } from '@shared/api';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { conversationTitle } from '@/lib/format';

/** What the person asked to do with a conversation: see the options, or go straight to one. */
export type ConversationAction = 'menu' | 'share' | 'rename' | 'delete';

const ACCESSIBILITY_ACTIONS: { name: Exclude<ConversationAction, 'menu'>; label: string }[] = [
  { name: 'share', label: 'Share' },
  { name: 'rename', label: 'Rename' },
  { name: 'delete', label: 'Delete' },
];

export function ConversationRow({
  conversation,
  active,
  onPress,
  onAction,
}: {
  conversation: ConversationSummary;
  active: boolean;
  onPress(): void;
  onAction(action: ConversationAction): void;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const [optionsFocused, setOptionsFocused] = useState(false);
  const title = conversationTitle(conversation);

  // The options button sits beside the row's button rather than inside it: a button can't contain another.
  return (
    <View style={[styles.row, { backgroundColor: active || hovered ? theme.surfaceMuted : 'transparent' }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        aria-selected={active}
        accessibilityActions={ACCESSIBILITY_ACTIONS}
        onAccessibilityAction={({ nativeEvent }) => {
          const action = ACCESSIBILITY_ACTIONS.find(({ name }) => name === nativeEvent.actionName);
          if (action) onAction(action.name);
        }}
        onPress={onPress}
        onLongPress={() => onAction('menu')}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={({ pressed }) => [styles.main, pressed && { backgroundColor: theme.surfaceMuted }]}>
        <Text numberOfLines={1} style={[styles.title, { color: theme.text }, active && styles.activeTitle]}>
          {title}
        </Text>
      </Pressable>
      {/* Phones use a long press; on web the options button shows on hover and on the open chat. */}
      {Platform.OS === 'web' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Options for ${title}`}
          onPress={() => onAction('menu')}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          onFocus={() => setOptionsFocused(true)}
          onBlur={() => setOptionsFocused(false)}
          style={[styles.options, { opacity: hovered || active || optionsFocused ? 1 : 0 }]}>
          <Ionicons name="ellipsis-horizontal" size={18} color={theme.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    borderRadius: Radius.md,
    paddingRight: Platform.OS === 'web' ? Spacing.xs : 0,
    gap: Spacing.xs,
  },
  main: { flex: 1, alignSelf: 'stretch', justifyContent: 'center', borderRadius: Radius.md, paddingHorizontal: Spacing.md },
  title: { fontSize: 15, paddingVertical: Spacing.sm },
  activeTitle: { fontWeight: '600' },
  options: { width: 32, height: 32, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
});

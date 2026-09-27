import { StyleSheet, Text, View } from 'react-native';
import { ICON_BUTTON_SIZE, IconButton } from '@/components/ui';
import { Spacing, useTheme } from '@/constants/theme';

/**
 * The chat's top bar: the menu that opens the chat list, the chat's title, Share once there is something to
 * share, and New chat.
 */
export function ChatHeader({
  title,
  onOpenMenu,
  onNewChat,
  share,
}: {
  title: string;
  onOpenMenu(): void;
  onNewChat(): void;
  share: { busy: boolean; onPress(): void } | null;
}) {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      {/* Both sides take the same width, so the title stays centred whether or not Share is shown. */}
      <View style={styles.side}>
        <IconButton icon="menu" label="Open chats" onPress={onOpenMenu} />
      </View>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]} numberOfLines={1}>
        {title}
      </Text>
      <View style={[styles.side, styles.end]}>
        {share ? (
          <IconButton
            icon="share-outline"
            label={share.busy ? 'Sharing conversation' : 'Share conversation'}
            onPress={share.onPress}
            busy={share.busy}
          />
        ) : null}
        <IconButton icon="create-outline" label="New chat" onPress={onNewChat} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs },
  side: { flexDirection: 'row', width: 2 * ICON_BUTTON_SIZE + Spacing.xs, gap: Spacing.xs },
  end: { justifyContent: 'flex-end' },
  title: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
});

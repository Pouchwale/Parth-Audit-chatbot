import { StyleSheet, Text, View } from 'react-native';
import { IconButton } from '@/components/ui';
import { Spacing, useTheme } from '@/constants/theme';

/** The chat's top bar: the menu that opens the chat list, the chat's title, and New chat. */
export function ChatHeader({ title, onOpenMenu, onNewChat }: { title: string; onOpenMenu(): void; onNewChat(): void }) {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <IconButton icon="menu" label="Open chats" onPress={onOpenMenu} />
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]} numberOfLines={1}>
        {title}
      </Text>
      <IconButton icon="create-outline" label="New chat" onPress={onNewChat} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs },
  title: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname } from 'expo-router';
import { useDrawerStatus, type DrawerContentComponentProps } from 'expo-router/drawer';
import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ConversationSummary } from '@shared/api';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { useConversations } from '@/lib/conversations';
import { ConversationActions } from './ConversationActions';
import { ConversationList } from './ConversationList';
import type { ConversationAction } from './ConversationRow';
import { DrawerFooter } from './DrawerFooter';
import { SearchField } from './SearchField';

const CHAT_PATH = /^\/chat\/([^/]+)$/;

// Browsers only move a closed drawer off screen, where Tab and screen readers still reach it. Phones hide it.
const CLOSED_ON_WEB = Platform.OS === 'web' ? { inert: true, 'aria-hidden': true } : null;

/** The side panel: new chat, searchable history, and the signed-in person's settings. */
export function ConversationDrawer({ navigation }: DrawerContentComponentProps) {
  const theme = useTheme();
  const activeId = CHAT_PATH.exec(usePathname())?.[1] ?? null;
  const open = useDrawerStatus() === 'open';
  const { refresh, startNewChat } = useConversations();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{ conversation: ConversationSummary; action: ConversationAction } | null>(null);

  // Load up front so the list is ready, then again whenever the drawer opens.
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // The drawer closes by itself only when the screen changes, not between two chats.
  function close() {
    Keyboard.dismiss();
    navigation.closeDrawer();
  }

  function newChat() {
    startNewChat();
    close();
  }

  function openConversation(id: string) {
    router.navigate({ pathname: '/chat/[id]', params: { id } });
    close();
  }

  function openScreen(href: '/settings' | '/admin') {
    close();
    router.push(href);
  }

  function deleted(conversation: ConversationSummary) {
    setSelected(null);
    if (conversation.id === activeId) startNewChat();
  }

  return (
    <SafeAreaView style={styles.drawer} edges={['top', 'bottom', 'left']} {...(open ? null : CLOSED_ON_WEB)}>
      <Text accessibilityRole="header" style={[styles.appName, { color: theme.text }]}>
        Audit Assistant
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={newChat}
        style={({ pressed }) => [styles.newChat, { backgroundColor: pressed ? theme.surfaceMuted : 'transparent' }]}>
        <View style={[styles.newChatIcon, { backgroundColor: theme.accent }]}>
          <Ionicons name="add" size={18} color={theme.onAccent} />
        </View>
        <Text style={[styles.newChatLabel, { color: theme.text }]}>New chat</Text>
      </Pressable>
      <SearchField value={query} onChangeText={setQuery} />
      <View style={styles.list}>
        <ConversationList
          query={query}
          activeId={activeId}
          onOpen={openConversation}
          onAction={(conversation, action) => setSelected({ conversation, action })}
        />
      </View>
      <DrawerFooter onOpenSettings={() => openScreen('/settings')} onOpenAccounts={() => openScreen('/admin')} />
      {selected ? (
        <ConversationActions
          conversation={selected.conversation}
          action={selected.action}
          onClose={() => setSelected(null)}
          onDeleted={() => deleted(selected.conversation)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  drawer: { flex: 1 },
  appName: { fontSize: 18, fontWeight: '700', paddingHorizontal: Spacing.lg + Spacing.xs, paddingTop: Spacing.lg, paddingBottom: Spacing.sm },
  newChat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 44,
    marginHorizontal: Spacing.sm,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
  },
  newChatIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  newChatLabel: { fontSize: 15, fontWeight: '600' },
  list: { flex: 1, overflow: 'hidden' },
});

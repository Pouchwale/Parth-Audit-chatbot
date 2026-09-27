import { Drawer } from 'expo-router/drawer';
import { useWindowDimensions } from 'react-native';
import { ConversationDrawer } from '@/components/drawer/ConversationDrawer';
import { useTheme } from '@/constants/theme';
import { ChatSessionsProvider } from '@/lib/chat-sessions';

export const unstable_settings = { anchor: 'index' };

const DRAWER_WIDTH = 320;
// Keep a strip of the chat visible beside the open drawer; tapping it closes the drawer.
const VISIBLE_CHAT_STRIP = 56;

export default function AppLayout() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  return (
    <ChatSessionsProvider>
      <Drawer
        drawerContent={(props) => <ConversationDrawer {...props} />}
        screenOptions={{
          // Chat screens draw their own header with the menu button (swiping is not available on web).
          headerShown: false,
          // iOS would otherwise slide the chat along with the drawer.
          drawerType: 'front',
          drawerStyle: { width: Math.min(DRAWER_WIDTH, width - VISIBLE_CHAT_STRIP), backgroundColor: theme.sidebar },
          overlayColor: theme.overlay,
          overlayAccessibilityLabel: 'Close chats',
          swipeEdgeWidth: 48,
        }}>
        <Drawer.Screen name="index" options={{ title: 'New chat' }} />
        <Drawer.Screen name="chat/[id]" options={{ title: 'Chat' }} />
      </Drawer>
    </ChatSessionsProvider>
  );
}

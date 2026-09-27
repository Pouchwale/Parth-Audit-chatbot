import { ChatScreen } from '@/components/chat/ChatScreen';
import { useConversations } from '@/lib/conversations';

export default function NewChatScreen() {
  // The drawer keeps this screen mounted; a new key gives each new chat a blank slate.
  const { newChatKey } = useConversations();
  return <ChatScreen key={newChatKey} />;
}

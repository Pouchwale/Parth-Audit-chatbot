import { useLocalSearchParams } from 'expo-router';
import { ChatScreen } from '@/components/chat/ChatScreen';

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // The drawer reuses this screen for every conversation; the key starts each one fresh.
  return <ChatScreen key={id} conversationId={id} />;
}

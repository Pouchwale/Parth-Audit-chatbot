import { StyleSheet, View } from 'react-native';
import { Spacing } from '@/constants/theme';
import type { ChatRequest } from '@/lib/chat-stream';
import { InlineError } from './InlineError';
import { UserBubble } from './UserBubble';

/**
 * A request that never reached the assistant, with why, and a button to send it again. A message is shown itself,
 * faded. (A change to a sent message that wasn't saved goes back to that message's editor instead.)
 */
export function UnsentRequest({ request, error, onResend }: { request: ChatRequest; error: string; onResend(): void }) {
  return (
    <View style={styles.unsent}>
      {request.kind === 'message' ? <UserBubble text={request.text} attachments={request.attachments} faded /> : null}
      <InlineError message={error} onRetry={onResend} />
    </View>
  );
}

const styles = StyleSheet.create({
  unsent: { gap: Spacing.sm },
});

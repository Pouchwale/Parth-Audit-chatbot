import { StyleSheet, View } from 'react-native';
import { Spacing } from '@/constants/theme';
import type { ChatRequest } from '@/lib/chat-stream';
import { InlineError } from './InlineError';
import { UserBubble } from './UserBubble';

/**
 * A request that never reached the assistant, with why, and a button to send it again. For a message, the message
 * itself is shown faded; for a change to a sent message, the conversation is back as it was, so only the reason shows.
 */
export function UnsentRequest({ request, error, onResend }: { request: ChatRequest; error: string; onResend(): void }) {
  return (
    <View style={styles.unsent}>
      {request.kind === 'message' ? <UserBubble text={request.text} attachments={request.attachments} faded /> : null}
      <InlineError message={request.kind === 'edit' ? `Your change wasn't saved. ${error}` : error} onRetry={onResend} />
    </View>
  );
}

const styles = StyleSheet.create({
  unsent: { gap: Spacing.sm },
});

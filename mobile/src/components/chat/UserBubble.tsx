import Ionicons from '@expo/vector-icons/Ionicons';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { FileInfo } from '@shared/api';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { tapFeedback } from '@/lib/haptics';
import { MessageAttachments } from './MessageAttachments';
import { useCopy } from './useCopy';

const COPY_ACTION = [{ name: 'copy', label: 'Copy' }];

/** Something the person said, right-aligned in a bubble, under the files they attached. A long press copies it. */
export function UserBubble({ text, attachments, faded = false }: { text: string; attachments?: readonly FileInfo[]; faded?: boolean }) {
  const theme = useTheme();
  const { copied, copy } = useCopy();

  function copyText() {
    tapFeedback();
    copy(text);
  }

  return (
    <View style={[styles.message, { opacity: faded ? 0.6 : 1 }]}>
      {attachments && attachments.length > 0 ? <MessageAttachments files={attachments} /> : null}
      <View style={styles.row}>
        {copied ? (
          <View style={styles.copied} accessibilityLiveRegion="polite">
            <Ionicons name="checkmark" size={14} color={theme.textSecondary} />
            <Text style={[styles.copiedText, { color: theme.textSecondary }]}>Copied</Text>
          </View>
        ) : null}
        <Pressable
          onLongPress={copyText}
          accessibilityHint="Long press to copy"
          accessibilityActions={COPY_ACTION}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === 'copy') copyText();
          }}
          style={[styles.bubble, { backgroundColor: theme.surfaceMuted }]}>
          {/* Selecting text would take over the long press on phones; browsers select with the mouse instead. */}
          <Text selectable={Platform.OS === 'web'} style={[styles.text, { color: theme.text }]}>
            {text}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  message: { gap: Spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: Spacing.sm },
  bubble: { maxWidth: '85%', borderRadius: Radius.lg + 2, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm + 2 },
  text: { fontSize: 16, lineHeight: 24 },
  copied: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  copiedText: { fontSize: 12 },
});

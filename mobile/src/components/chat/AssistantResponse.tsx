import Ionicons from '@expo/vector-icons/Ionicons';
import { Platform, StyleSheet, Text, View } from 'react-native';
import type { AssistantMessage, MessagePart } from '@shared/api';
import { Spacing, useTheme } from '@/constants/theme';
import { LANGUAGE_NAMES, type SpeechLanguage } from '@/lib/speech-voice';
import { messageText } from '@/lib/transcript';
import { ActivityRow } from './ActivityRow';
import { AssistantMark } from './AssistantMark';
import { ConfirmationCard } from './ConfirmationCard';
import { FileCard } from './FileCard';
import { InlineError } from './InlineError';
import { Markdown } from './Markdown';
import { MessageActions } from './MessageActions';
import { Thinking } from './Thinking';
import { WaitingLine } from './WaitingLine';

type Decision = 'confirm' | 'cancel';

/** Why the words of a language in a reply weren't read aloud: this device has no voice for it. */
function unvoicedNote(language: SpeechLanguage): string {
  const name = LANGUAGE_NAMES[language];
  if (Platform.OS === 'web') return `No ${name} voice in this browser, so the ${name} isn't read aloud.`;
  if (Platform.OS === 'ios') return `No ${name} voice on this iPhone, so the ${name} isn't read aloud.`;
  return `No ${name} voice on this phone, so the ${name} isn't read aloud. You can add one in the phone's text-to-speech settings.`;
}

/** A reply from the assistant: full-width text, lookups, confirmation cards and files, then its status and actions. */
export function AssistantResponse({
  message,
  answerableId,
  deciding,
  busy,
  reading,
  unvoiced = null,
  waiting = null,
  onDecide,
  onRetry,
}: {
  message: AssistantMessage;
  /** The confirmation the person can answer now, wherever it is. */
  answerableId: string | null;
  /** The answer being sent, and to which confirmation. */
  deciding: { confirmationId: string; decision: Decision } | null;
  /** A request is running. */
  busy: boolean;
  /** This reply is being read aloud. */
  reading: boolean;
  /** A language of this reply that wasn't read aloud, for want of a voice for it on this device. */
  unvoiced?: SpeechLanguage | null;
  /** This reply is being written, and waits for the assistant's model, which is busy. */
  waiting?: { retryInMs: number; since: number } | null;
  onDecide(confirmationId: string, decision: Decision): void;
  /** Continues this reply after it failed; missing when it can't be continued. */
  onRetry?: () => void;
}) {
  const theme = useTheme();
  const streaming = message.status === 'streaming';
  const last = message.parts.at(-1);
  const text = streaming ? '' : messageText(message);
  const thinking = streaming && last?.type !== 'text' && !(last?.type === 'activity' && last.status === 'running');

  function renderPart(part: MessagePart, index: number) {
    switch (part.type) {
      case 'text':
        return <Markdown key={`text-${index}`} value={part.text} streaming={streaming && part === last} />;
      case 'activity':
        return <ActivityRow key={`activity-${part.id}`} activity={part} />;
      case 'confirmation':
        return (
          <ConfirmationCard
            key={`confirmation-${part.id}`}
            part={part}
            answerable={part.id === answerableId}
            deciding={deciding?.confirmationId === part.id ? deciding.decision : null}
            disabled={busy}
            onDecide={(decision) => onDecide(part.id, decision)}
          />
        );
      case 'file':
        return <FileCard key={`file-${part.file.id}`} file={part.file} />;
    }
  }

  return (
    <View style={styles.row}>
      <AssistantMark />
      <View style={styles.body}>
        {message.parts.map(renderPart)}
        {streaming && waiting ? <WaitingLine waiting={waiting} /> : thinking ? <Thinking /> : null}
        {message.status === 'stopped' ? (
          <View style={styles.note}>
            <Ionicons name="stop-circle-outline" size={16} color={theme.textSecondary} />
            <Text style={[styles.noteText, { color: theme.textSecondary }]}>Stopped</Text>
          </View>
        ) : null}
        {message.status === 'error' ? <InlineError message={message.error ?? 'Something went wrong.'} onRetry={onRetry} /> : null}
        {text ? <MessageActions id={message.id} text={text} reading={reading} /> : null}
        {unvoiced ? (
          <View style={styles.note}>
            <Ionicons name="volume-mute-outline" size={16} color={theme.textSecondary} style={styles.noteIcon} />
            <Text style={[styles.noteText, styles.noteLines, { color: theme.textSecondary }]}>{unvoicedNote(unvoiced)}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.md },
  body: { flex: 1, minWidth: 0, gap: Spacing.xs },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  noteIcon: { alignSelf: 'flex-start', marginTop: 1 },
  noteText: { fontSize: 13 },
  noteLines: { flex: 1, lineHeight: 18 },
});

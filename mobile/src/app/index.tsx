import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AssistantReply, Confirmation } from '@shared/api';
import { Button, IconButton } from '@/components/ui';
import { MaxContentWidth, Radius, Spacing, useTheme } from '@/constants/theme';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { timeZone } from '@/lib/device';
import { speak, stopSpeaking, useVoiceInput } from '@/lib/voice';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'notice';
  text: string;
}

// Answers to a waiting confirmation, spoken or typed. Anything else is treated as a new request.
const YES = /^\s*(yes|yeah|yep|yup|confirm(ed)?|go ahead|do it|ok(ay)?|sure|proceed)\b/i;
const NO = /^\s*(no|nope|cancel|stop|don'?t|do not|never ?mind)\b/i;

// After a long pause, start a fresh conversation so old context doesn't leak into a new request.
const IDLE_MS = 30 * 60_000;

let nextId = 0;

export default function AssistantScreen() {
  const theme = useTheme();
  const { user, call, signOut } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]); // newest first, for the inverted list
  const [conversationId, setConversationId] = useState<string>();
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(true);
  const lastActivity = useRef(0);

  const voice = useVoiceInput({
    onPartial: setDraft,
    onFinal: (text) => submit(text),
    onError: (message) => add('notice', message),
  });

  function add(role: ChatMessage['role'], text: string) {
    setMessages((current) => [{ id: String(++nextId), role, text }, ...current]);
  }

  async function run(request: (token: string) => Promise<AssistantReply>) {
    setBusy(true);
    try {
      const reply = await call(request);
      setConversationId(reply.conversationId);
      setConfirmation(reply.confirmation);
      if (reply.reply) add('assistant', reply.reply);
      if (voiceReplies) speak([reply.reply, reply.confirmation && spokenPrompt(reply.confirmation)].filter(Boolean).join(' '));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return; // signed out; the sign-in screen says why
      const message = errorMessage(error);
      add('notice', message);
      if (voiceReplies) speak(message);
    } finally {
      setBusy(false);
      lastActivity.current = Date.now();
    }
  }

  function submit(text: string) {
    const request = text.trim();
    if (!request || busy) return;
    setDraft('');
    if (confirmation && YES.test(request)) return decide('confirm', request);
    if (confirmation && NO.test(request)) return decide('cancel', request);

    add('user', request);
    setConfirmation(null);
    const current = Date.now() - lastActivity.current < IDLE_MS ? conversationId : undefined;
    return run(async (token) => {
      try {
        return await api.send(token, { conversationId: current, text: request, timeZone: timeZone() });
      } catch (error) {
        // The server clears out old conversations; carry on in a new one.
        if (current && error instanceof ApiError && error.code === 'conversation_not_found') {
          return api.send(token, { text: request, timeZone: timeZone() });
        }
        throw error;
      }
    });
  }

  function decide(decision: 'confirm' | 'cancel', said?: string) {
    if (!confirmation || !conversationId || busy) return;
    const pending = confirmation;
    add('user', said ?? (decision === 'confirm' ? 'Confirm' : 'Cancel'));
    setConfirmation(null);
    return run((token) => api.decide(token, conversationId, { confirmationId: pending.id, decision, timeZone: timeZone() }));
  }

  function newConversation() {
    stopSpeaking();
    voice.stop();
    setMessages([]);
    setConversationId(undefined);
    setConfirmation(null);
    setDraft('');
  }

  function toggleListening() {
    if (voice.listening) return voice.stop();
    stopSpeaking();
    setDraft('');
    void voice.start();
  }

  const canSend = draft.trim().length > 0 && !busy && !voice.listening;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.text }]}>Assistant</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
            Signed in as {user?.displayName}
          </Text>
        </View>
        <IconButton
          icon={voiceReplies ? 'volume-high-outline' : 'volume-mute-outline'}
          label={voiceReplies ? 'Stop reading replies aloud' : 'Read replies aloud'}
          onPress={() => {
            if (voiceReplies) stopSpeaking();
            setVoiceReplies(!voiceReplies);
          }}
        />
        <IconButton icon="add-circle-outline" label="New conversation" onPress={newConversation} />
        {user?.role === 'super_admin' ? <IconButton icon="people-outline" label="Accounts" onPress={() => router.push('/admin')} /> : null}
        <IconButton icon="log-out-outline" label="Sign out" onPress={signOut} />
      </View>

      <KeyboardAvoidingView behavior="padding" style={styles.body}>
        <View style={styles.column}>
          {messages.length === 0 && !busy ? (
            <EmptyState voice={voice.available} />
          ) : (
            <FlatList
              inverted
              data={messages}
              keyExtractor={(message) => message.id}
              renderItem={({ item }) => <Bubble message={item} />}
              ListHeaderComponent={busy ? <Thinking /> : null}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
            />
          )}

          {confirmation ? (
            <ConfirmationCard confirmation={confirmation} busy={busy} onConfirm={() => decide('confirm')} onCancel={() => decide('cancel')} />
          ) : null}

          <View style={[styles.composer, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={voice.listening ? 'Listening…' : confirmation ? 'Say or type "confirm" or "cancel"' : 'Ask or tell me what to do'}
              placeholderTextColor={theme.textSecondary}
              multiline
              submitBehavior="submit"
              returnKeyType="send"
              onSubmitEditing={() => submit(draft)}
              onKeyPress={(event) => {
                // Web: Enter sends and Shift+Enter starts a new line. Phones use the keyboard's send key.
                const key = event.nativeEvent as { key: string; shiftKey?: boolean };
                if (Platform.OS === 'web' && key.key === 'Enter' && !key.shiftKey) {
                  event.preventDefault();
                  submit(draft);
                }
              }}
              editable={!voice.listening}
              accessibilityLabel="Message"
              style={[styles.input, { color: theme.text, backgroundColor: theme.surfaceMuted }]}
            />
            {canSend || !voice.available ? (
              <RoundButton icon="arrow-up" label="Send" onPress={() => submit(draft)} disabled={!canSend} />
            ) : (
              <RoundButton
                icon={voice.listening ? 'stop' : 'mic'}
                label={voice.listening ? 'Stop listening' : 'Speak your request'}
                onPress={toggleListening}
                disabled={busy}
                danger={voice.listening}
                large
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function spokenPrompt(confirmation: Confirmation): string {
  return `Please confirm: ${confirmation.changes.map((change) => change.summary).join('. ')}. Say confirm or cancel.`;
}

function Bubble({ message }: { message: ChatMessage }) {
  const theme = useTheme();
  if (message.role === 'notice') {
    return <Text style={[styles.notice, { color: theme.textSecondary }]}>{message.text}</Text>;
  }
  const mine = message.role === 'user';
  return (
    <View style={[styles.bubbleRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
      <View
        style={[
          styles.bubble,
          mine
            ? { backgroundColor: theme.accent, borderBottomRightRadius: Radius.sm }
            : { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderBottomLeftRadius: Radius.sm },
        ]}>
        <Text selectable style={[styles.bubbleText, { color: mine ? theme.onAccent : theme.text }]}>
          {message.text}
        </Text>
      </View>
    </View>
  );
}

function Thinking() {
  const theme = useTheme();
  return (
    <View style={styles.bubbleRow}>
      <View style={[styles.bubble, styles.thinking, { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1 }]}>
        <ActivityIndicator size="small" color={theme.textSecondary} />
        <Text style={{ color: theme.textSecondary }}>Working on it…</Text>
      </View>
    </View>
  );
}

function EmptyState({ voice }: { voice: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.accentSoft }]}>
        <Ionicons name={voice ? 'mic' : 'chatbubble-ellipses'} size={36} color={theme.accent} />
      </View>
      <Text style={[styles.emptyTitle, { color: theme.text }]}>What do you need done?</Text>
      <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
        {voice ? 'Tap the microphone and say it, or type it below.' : 'Type your request below.'} I can look things up in the Digital
        Controlled Record System and make changes for you. I always ask before changing anything.
      </Text>
    </View>
  );
}

function ConfirmationCard({
  confirmation,
  busy,
  onConfirm,
  onCancel,
}: {
  confirmation: Confirmation;
  busy: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  const theme = useTheme();
  const count = confirmation.changes.length;
  return (
    <View style={[styles.confirm, { backgroundColor: theme.warningSoft, borderColor: theme.warning }]} accessibilityLiveRegion="polite">
      <View style={styles.confirmHeader}>
        <Ionicons name="shield-checkmark-outline" size={20} color={theme.warning} />
        <Text style={[styles.confirmTitle, { color: theme.text }]}>{count === 1 ? 'Confirm this change' : `Confirm these ${count} changes`}</Text>
      </View>
      {confirmation.changes.map((change, index) => (
        <View key={index} style={[styles.change, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.changeSystem, { color: theme.textSecondary }]}>{change.system}</Text>
          <Text style={[styles.changeSummary, { color: theme.text }]}>{change.summary}</Text>
        </View>
      ))}
      <Text style={[styles.confirmHint, { color: theme.textSecondary }]}>Nothing changes until you confirm.</Text>
      <View style={styles.confirmButtons}>
        <Button title="Cancel" kind="secondary" onPress={onCancel} disabled={busy} style={styles.flex} />
        <Button title="Confirm" onPress={onConfirm} disabled={busy} style={styles.flex} />
      </View>
    </View>
  );
}

function RoundButton({
  icon,
  label,
  onPress,
  disabled,
  danger,
  large,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress(): void;
  disabled?: boolean;
  danger?: boolean;
  large?: boolean;
}) {
  const theme = useTheme();
  const size = large ? 52 : 44;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.round,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: danger ? theme.danger : theme.accent,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
      ]}>
      <Ionicons name={icon} size={large ? 26 : 22} color={theme.onAccent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: { flex: 1 },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { fontSize: 13 },
  body: { flex: 1 },
  column: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  list: { padding: Spacing.lg, gap: Spacing.sm },
  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '85%', borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2 },
  bubbleText: { fontSize: 16, lineHeight: 22 },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  notice: { textAlign: 'center', fontSize: 14, lineHeight: 20, paddingHorizontal: Spacing.xl },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.md },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  emptyText: { fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 420 },
  confirm: { marginHorizontal: Spacing.lg, marginBottom: Spacing.sm, borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm },
  confirmHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  confirmTitle: { fontSize: 16, fontWeight: '700' },
  change: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md, gap: 2 },
  changeSystem: { fontSize: 12, fontWeight: '600' },
  changeSummary: { fontSize: 15, lineHeight: 21 },
  confirmHint: { fontSize: 13 },
  confirmButtons: { flexDirection: 'row', gap: Spacing.sm },
  flex: { flex: 1 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 22,
    paddingHorizontal: Spacing.lg,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: 16,
  },
  round: { alignItems: 'center', justifyContent: 'center' },
});

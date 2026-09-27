import { router, useIsFocused, useNavigation } from 'expo-router';
import type { DrawerNavigationProp } from 'expo-router/drawer';
import type { ParamListBase } from 'expo-router/react-navigation';
import { useEffect, useEffectEvent, useState, type ReactElement } from 'react';
import { KeyboardAvoidingView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ChatMessage } from '@shared/api';
import { MaxContentWidth, useTheme } from '@/constants/theme';
import { answerTo } from '@/lib/answer';
import type { FinishedReply } from '@/lib/chat-session';
import { useChatSessions, useChatState } from '@/lib/chat-sessions';
import { MAX_MESSAGE_LENGTH } from '@/lib/chat-stream';
import { useConversations } from '@/lib/conversations';
import { tapFeedback } from '@/lib/haptics';
import { useSettings } from '@/lib/settings';
import { speak, stopSpeaking, useReading } from '@/lib/speech';
import { pendingConfirmation, spokenReply } from '@/lib/transcript';
import { useVoiceInput } from '@/lib/voice';
import { AssistantResponse } from './AssistantResponse';
import { ChatHeader } from './ChatHeader';
import { Composer } from './Composer';
import { HistoryError, HistorySkeleton } from './HistoryState';
import { MessageList } from './MessageList';
import { UnsentRequest } from './UnsentRequest';
import { UserBubble } from './UserBubble';
import { Welcome } from './Welcome';

type Decision = 'confirm' | 'cancel';

/** A conversation: a new one when `conversationId` is missing, otherwise the saved one. */
export function ChatScreen({ conversationId }: { conversationId?: string }) {
  const theme = useTheme();
  const navigation = useNavigation<DrawerNavigationProp<ParamListBase>>();
  // The drawer keeps a chat mounted once it has been shown, and so does a screen opened on top of it.
  const focused = useIsFocused();
  const sessions = useChatSessions();
  const [session, setSession] = useState(() => sessions.open(conversationId));
  const state = useChatState(session);
  const { settings } = useSettings();
  const { conversations, startNewChat } = useConversations();
  const reading = useReading();
  const [draft, setDraft] = useState('');

  const busy = state.running !== null;
  const ready = state.history.status === 'ready';
  // Nothing can be answered while the reply it belongs to is still out of date here.
  const pending = ready && !state.settling ? pendingConfirmation(state.messages) : null;

  /** Sends what the person typed or said. A plain yes or no answers the waiting confirmation instead. */
  function submit(text: string, spoken: boolean): boolean {
    const request = text.trim();
    if (!request || request.length > MAX_MESSAGE_LENGTH || busy || !ready) return false;
    stopSpeaking();
    tapFeedback();
    const answer = pending ? answerTo(request) : null;
    if (pending && answer) session.decide(pending.id, answer, spoken);
    else session.send(request, spoken);
    return true;
  }

  function onHeard(text: string) {
    if (settings.autoSendVoice && submit(text, true)) return;
    setDraft((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
  }

  const voice = useVoiceInput(onHeard);

  useEffect(() => {
    session.load();
  }, [session]);

  // A new chat moves to its own address once the server has created it. The reply keeps streaming there,
  // and this screen starts over, ready for the next new chat. Someone who has gone elsewhere meanwhile stays
  // there, and finds the chat in the list.
  useEffect(() => {
    if (conversationId || !state.conversationId) return;
    if (focused) router.replace({ pathname: '/chat/[id]', params: { id: state.conversationId } });
    setSession(sessions.open());
  }, [conversationId, state.conversationId, sessions, focused]);

  const onReply = useEffectEvent(({ reply, spoken }: FinishedReply) => {
    const { readAloud } = settings;
    if (focused && (readAloud === 'always' || (readAloud === 'afterVoice' && spoken))) speak(spokenReply(reply), reply.message.id);
  });
  useEffect(() => session.onReply((finished) => onReply(finished)), [session]);

  // Leaving the chat, not only closing it, ends a take and stops reading aloud.
  const leave = useEffectEvent(() => {
    voice.cancel();
    stopSpeaking();
  });
  useEffect(() => {
    if (!focused) return;
    return () => leave();
  }, [focused]);

  function decide(confirmationId: string, decision: Decision) {
    stopSpeaking();
    tapFeedback();
    session.decide(confirmationId, decision, false);
  }

  const lastReply = state.messages.findLast((message) => message.role === 'assistant');
  const deciding = state.running?.kind === 'decision' ? state.running : null;

  function renderMessage(message: ChatMessage): ReactElement {
    if (message.role === 'user') return <UserBubble text={message.text} />;
    const retryable = !busy && message === lastReply && message.status === 'error';
    return (
      <AssistantResponse
        message={message}
        answerableId={pending?.id ?? null}
        deciding={deciding}
        busy={busy}
        reading={reading === message.id}
        onDecide={decide}
        onRetry={retryable ? () => session.retry() : undefined}
      />
    );
  }

  let content: ReactElement;
  if (state.history.status === 'loading') {
    content = <HistorySkeleton />;
  } else if (state.history.status === 'failed') {
    content = <HistoryError message={state.history.error} gone={state.history.gone} onRetry={() => session.reload()} onNewChat={startNewChat} />;
  } else if (state.messages.length === 0 && !state.unsent) {
    content = <Welcome onPick={(text) => submit(text, false)} />;
  } else {
    const { unsent } = state;
    content = (
      <MessageList
        messages={state.messages}
        busy={busy}
        footer={unsent ? <UnsentRequest request={unsent.request} error={unsent.error} onResend={() => session.resend()} /> : null}
        renderMessage={renderMessage}
      />
    );
  }

  // The history list has the newest title, including a rename made there.
  const saved = conversations?.find((conversation) => conversation.id === state.conversationId);
  const title = saved?.title ?? state.title ?? (state.history.status === 'loading' ? '' : 'New chat');

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <ChatHeader title={title} onOpenMenu={() => navigation.openDrawer()} onNewChat={startNewChat} />
      <KeyboardAvoidingView behavior="padding" style={styles.body}>
        <View style={styles.column}>
          {content}
          <Composer
            value={draft}
            onChangeText={setDraft}
            onSend={() => {
              if (submit(draft, false)) setDraft('');
            }}
            onStop={() => session.stop()}
            busy={busy}
            stopping={state.stopping}
            disabled={!ready}
            voice={voice}
            sendsVoice={settings.autoSendVoice}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
  column: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
});

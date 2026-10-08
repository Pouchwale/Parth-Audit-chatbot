import { router, useIsFocused, useNavigation } from 'expo-router';
import { useDrawerStatus, type DrawerNavigationProp } from 'expo-router/drawer';
import type { ParamListBase } from 'expo-router/react-navigation';
import { useEffect, useEffectEvent, useState, type ReactElement } from 'react';
import { KeyboardAvoidingView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaxContentWidth, useTheme } from '@/constants/theme';
import { answerTo } from '@/lib/answer';
import { attachedFilesText, useAttachments } from '@/lib/attachments';
import { madeChangesAfter, type FinishedReply } from '@/lib/chat-session';
import { useChatSessions, useChatState } from '@/lib/chat-sessions';
import { MAX_MESSAGE_LENGTH } from '@/lib/chat-stream';
import { useConversations } from '@/lib/conversations';
import { tapFeedback } from '@/lib/haptics';
import { useSettings } from '@/lib/settings';
import { useShareConversation } from '@/lib/share';
import { speak, stopSpeaking, useReading, useVoiceNote } from '@/lib/speech';
import { mainLanguage } from '@/lib/speech-voice';
import { pendingConfirmation, spokenReply } from '@/lib/transcript';
import { useVoiceInput } from '@/lib/voice';
import { ChatControlsProvider, type ChatControls, type Decision } from './chat-controls';
import { ChatHeader } from './ChatHeader';
import { Composer } from './Composer';
import { Disclaimer } from './Disclaimer';
import { HistoryError, HistorySkeleton } from './HistoryState';
import { MessageList } from './MessageList';
import { SessionEndNotice } from './SessionEndNotice';
import { ShareNotice } from './ShareNotice';
import { UnsentRequest } from './UnsentRequest';
import { Welcome } from './Welcome';

/** A conversation: a new one when `conversationId` is missing, otherwise the saved one. */
export function ChatScreen({ conversationId }: { conversationId?: string }) {
  const theme = useTheme();
  const navigation = useNavigation<DrawerNavigationProp<ParamListBase>>();
  // The drawer keeps a chat mounted once it has been shown, and so does a screen opened on top of it.
  const focused = useIsFocused();
  const drawerOpen = useDrawerStatus() === 'open';
  const sessions = useChatSessions();
  const [session, setSession] = useState(() => sessions.open(conversationId));
  const state = useChatState(session);
  const { settings } = useSettings();
  const { conversations, startNewChat } = useConversations();
  const reading = useReading();
  const voiceNote = useVoiceNote();
  const sharing = useShareConversation();
  const [draft, setDraft] = useState('');
  const attachments = useAttachments();

  const busy = state.running !== null;
  const ready = state.history.status === 'ready';
  // Nothing can be answered while the reply it belongs to is still out of date here.
  const pending = ready && !state.settling ? pendingConfirmation(state.messages) : null;

  /**
   * Sends what the person typed or said, with the files they attached. A plain yes or no, without files, answers the
   * waiting confirmation instead.
   */
  function submit(text: string, spoken: boolean): boolean {
    const { files } = attachments;
    // The server needs words with every message, so files sent on their own get some.
    const request = text.trim() || attachedFilesText(files.length);
    if (!request || request.length > MAX_MESSAGE_LENGTH || busy || !ready || !attachments.ready) return false;
    stopSpeaking();
    tapFeedback();
    const answer = pending && files.length === 0 ? answerTo(request) : null;
    if (pending && answer) {
      session.decide(pending.id, answer, spoken);
    } else {
      session.send(request, spoken, files);
      attachments.clear();
    }
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
    const { readAloud, replyLanguage } = settings;
    if (!focused || !(readAloud === 'always' || (readAloud === 'afterVoice' && spoken))) return;
    // A card's question is asked in the reply's language; a reply with no words of its own (only the card) asks it
    // in the language chosen for replies, or the one the request was written in.
    const request = state.messages.findLast((message) => message.role === 'user');
    const asked = replyLanguage === 'auto' ? mainLanguage(request?.text ?? '') : replyLanguage;
    speak(spokenReply(reply, asked), reply.message.id);
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

  function retry() {
    session.retry();
  }

  function startEdit(messageId: string) {
    stopSpeaking();
    session.openEditor(messageId);
  }

  function cancelEdit() {
    session.closeEditor();
  }

  function saveEdit(messageId: string, text: string) {
    tapFeedback();
    session.edit(messageId, text);
  }

  // Worked out as the screen is drawn, so the editor says changes stay as soon as a change after its message runs.
  // Kept to plain values, so the controls change only when one of them does, not with every streamed piece.
  const editorId = state.editor?.messageId ?? null;
  const editorError = state.editor?.error ?? null;
  const editorFocus = state.editor?.focus ?? false;
  const editorMadeChanges = editorId !== null && madeChangesAfter(state.messages, editorId);
  const editing = editorId === null ? null : { id: editorId, error: editorError, madeChanges: editorMadeChanges, focus: editorFocus };

  const controls: ChatControls = {
    busy,
    answerableId: pending?.id ?? null,
    deciding: state.running?.kind === 'decision' ? state.running : null,
    reading,
    voiceNote,
    waiting: state.waiting,
    editing,
    inFront: focused && !drawerOpen,
    decide,
    retry,
    startEdit,
    cancelEdit,
    saveEdit,
    editorFocused: () => session.editorFocused(),
    draftOf: session.draftOf,
    keepDraft: session.keepDraft,
  };

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
        editingId={editorId}
        footer={unsent ? <UnsentRequest request={unsent.request} error={unsent.error} onResend={() => session.resend()} /> : null}
      />
    );
  }

  // The history list has the newest title, including a rename made there.
  const saved = conversations?.find((conversation) => conversation.id === state.conversationId);
  const title = saved?.title ?? state.title ?? (state.history.status === 'loading' ? '' : 'New chat');
  // A reply still being written can be shared too: the file holds what the server has saved so far.
  const shareableId = state.messages.length > 0 ? state.conversationId : null;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <ChatHeader
        title={title}
        onOpenMenu={() => navigation.openDrawer()}
        onNewChat={startNewChat}
        share={shareableId ? { busy: sharing.state.status === 'exporting', onPress: () => sharing.share(shareableId) } : null}
      />
      <KeyboardAvoidingView behavior="padding" style={styles.body}>
        <View style={styles.column}>
          <ChatControlsProvider value={controls}>{content}</ChatControlsProvider>
          <SessionEndNotice />
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
            attachments={attachments}
          />
          <Disclaimer />
          <ShareNotice state={sharing.state} onDismiss={sharing.reset} />
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

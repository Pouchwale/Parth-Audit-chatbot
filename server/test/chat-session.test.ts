// What the phone app's chat session does when a person edits a message (mobile/src/lib/chat-session.ts): the editor and
// the words typed into it, an edit the server never took, an edit it did, and which replies made changes. The app has
// no test runner of its own, and the session is plain TypeScript, so it is checked here with the server's tests. The
// two files it needs that only run on a phone or in a browser (its calls to the server) are replaced: what is checked
// is the session's own handling of what they answer.
import { beforeEach, expect, it, vi } from 'vitest';
import type { AssistantMessage, AssistantReply, ChatMessage, ConversationDetail, MessagePart, StreamEvent, UserMessage } from '@shared/api.ts';

type Progress = (event: Exclude<StreamEvent, { type: 'done' | 'error' }>) => void;
type Request = { kind: string; messageId?: string; text?: string };

/** What the replaced server calls do in each test. */
const server = vi.hoisted(() => ({
  /** Answers a request: it reports progress, and resolves with the reply or rejects like a failed request. */
  answer: undefined as undefined | ((request: Request, progress: Progress) => Promise<AssistantReply>),
  /** The conversation the app loads when it opens one. */
  saved: undefined as undefined | ConversationDetail,
  requests: [] as Request[],
}));

vi.mock('../../mobile/src/lib/chat-stream.ts', () => ({
  MAX_MESSAGE_LENGTH: 4000,
  streamChat: async (_token: string, request: Request, progress: Progress) => {
    server.requests.push(request);
    return server.answer!(request, progress);
  },
}));
vi.mock('../../mobile/src/lib/api.ts', () => {
  class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return {
    ApiError,
    errorMessage: (error: unknown) => (error instanceof ApiError ? error.message : 'Something went wrong. Try again.'),
    api: { conversation: async () => server.saved },
  };
});

interface State {
  conversationId: string | null;
  messages: readonly ChatMessage[];
  running: Request | null;
  unsent: { request: Request; error: string } | null;
  editor: { messageId: string; error: string | null; focus: boolean } | null;
  history: { status: string };
}
interface Session {
  getState(): State;
  load(): void;
  send(text: string, spoken: boolean, attachments: []): void;
  resend(): void;
  edit(messageId: string, text: string): void;
  openEditor(messageId: string): void;
  closeEditor(): void;
  editorFocused(): void;
  draftOf(messageId: string): string | null;
  keepDraft(messageId: string, text: string): void;
}
interface SessionModule {
  ChatSession: new (
    deps: { call<T>(request: (token: string) => Promise<T>): Promise<T>; changed(): void; busy(): void; who?(): string | null },
    conversationId?: string,
  ) => Session;
  madeChangesAfter(messages: readonly ChatMessage[], messageId: string): boolean;
}
// Loaded by a path the server's typecheck does not follow: the app's files are the app's typecheck's.
const APP_MODULE: string = new URL('../../mobile/src/lib/chat-session.ts', import.meta.url).href;
const { ChatSession, madeChangesAfter } = (await import(APP_MODULE)) as SessionModule;
const { ApiError } = (await import(new URL('../../mobile/src/lib/api.ts', import.meta.url).href)) as {
  ApiError: new (status: number, code: string, message: string) => Error;
};

const AT = '2026-10-03T06:00:00.000Z';
const user = (id: string, text: string): UserMessage => ({ id, role: 'user', text, createdAt: AT });
const assistant = (id: string, parts: MessagePart[] = [{ type: 'text', text: `Reply to ${id}` }], status: AssistantMessage['status'] = 'complete'): AssistantMessage => ({
  id,
  role: 'assistant',
  parts,
  status,
  error: null,
  createdAt: AT,
});
const conversation = (): ChatMessage[] => [user('u1', 'First question'), assistant('a1'), user('u2', 'Second question'), assistant('a2')];

/** A session on a saved conversation of four messages, once it has loaded. */
async function opened(): Promise<Session> {
  server.saved = { id: 'c1', title: 'Questions', messages: conversation(), createdAt: AT, updatedAt: AT };
  const session = new ChatSession({ call: (request) => request('token'), changed: () => {}, busy: () => {} }, 'c1');
  session.load();
  await vi.waitFor(() => expect(session.getState().history.status).toBe('ready'));
  return session;
}

const finished = (session: Session) => vi.waitFor(() => expect(session.getState().running).toBeNull());

/** A reply the server finishes at once, for an edit it takes: the start event carries the message as saved. */
function takesTheEdit(newWords: string): (request: Request, progress: Progress) => Promise<AssistantReply> {
  return async (request, progress) => {
    const edited: UserMessage = { ...user(request.messageId!, newWords), editedAt: AT };
    const started = assistant('a-new', [], 'streaming');
    progress({ type: 'start', conversationId: 'c1', title: null, userMessage: edited, message: started });
    progress({ type: 'delta', text: 'Here is the answer.' });
    const message = assistant('a-new', [{ type: 'text', text: 'Here is the answer.' }]);
    return { conversationId: 'c1', reply: 'Here is the answer.', confirmation: null, message, title: null };
  };
}

beforeEach(() => {
  server.answer = undefined;
  server.requests = [];
});

it('keeps the words typed into an editor, so that the editor comes back with them when its message is drawn again', async () => {
  const session = await opened();
  session.openEditor('u1');
  expect(session.getState().editor).toEqual({ messageId: 'u1', error: null, focus: true });
  expect(session.draftOf('u1')).toBeNull();

  session.keepDraft('u1', 'First question, but better');
  // The box has the keyboard now: drawn again after being scrolled out of view, it must not take it from the person.
  session.editorFocused();
  expect(session.getState().editor).toEqual({ messageId: 'u1', error: null, focus: false });
  expect(session.draftOf('u1')).toBe('First question, but better');

  // One editor at a time: opening another drops the words typed into the first, and so does closing.
  session.openEditor('u2');
  expect(session.draftOf('u1')).toBeNull();
  expect(session.getState().editor?.messageId).toBe('u2');
  session.keepDraft('u2', 'typed');
  session.closeEditor();
  expect(session.draftOf('u2')).toBeNull();
  expect(session.getState().editor).toBeNull();

  // Only a message the person sent can be edited.
  session.openEditor('a1');
  expect(session.getState().editor).toBeNull();
});

it('puts the conversation back as it was when the server never takes a change, a message that failed to send included, and opens the editor again on the words typed, with why', async () => {
  const session = await opened();
  // A message that never reached the server stays beside the conversation, with its words, to be sent again.
  server.answer = async () => {
    throw new ApiError(0, 'unreachable', "Mitra can't reach its server.");
  };
  session.send('A third question', false, []);
  await finished(session);
  const before = session.getState();
  expect(before.unsent).toMatchObject({ request: { kind: 'message', text: 'A third question' }, error: "Mitra can't reach its server." });
  expect(before.messages).toEqual(conversation());

  session.openEditor('u1');
  server.answer = async () => {
    throw new ApiError(409, 'conversation_busy', 'A reply in this chat is still being written. Wait for it, then try again.');
  };
  session.edit('u1', 'First question, changed');
  // At once the edited words show, with everything after them gone, and the editor has closed on them.
  expect(session.getState().messages).toMatchObject([{ id: 'u1', text: 'First question, changed' }, { role: 'assistant', status: 'streaming' }]);
  expect(session.getState().editor).toBeNull();
  await finished(session);

  const after = session.getState();
  expect(after.messages).toEqual(conversation());
  expect(after.unsent).toEqual(before.unsent);
  expect(after.editor).toEqual({ messageId: 'u1', error: 'A reply in this chat is still being written. Wait for it, then try again.', focus: false });
  expect(session.draftOf('u1')).toBe('First question, changed');
});

it('shows an edit at once, with what came after it gone, and lets go of the typed words once the server has taken the change', async () => {
  const session = await opened();
  let finish: () => void = () => {};
  const gate = new Promise<void>((resolve) => (finish = resolve));
  const takes = takesTheEdit('First question, changed');
  server.answer = async (request, progress) => {
    await gate;
    return takes(request, progress);
  };
  session.openEditor('u1');
  session.keepDraft('u1', 'First question, changed');
  session.edit('u1', 'First question, changed');

  const during = session.getState();
  expect(during.messages).toMatchObject([{ id: 'u1', text: 'First question, changed' }, { role: 'assistant', status: 'streaming' }]);
  expect(during.editor).toBeNull();
  expect(session.draftOf('u1')).toBe('First question, changed');

  finish();
  await finished(session);
  const after = session.getState();
  expect(after.messages).toEqual([
    { ...user('u1', 'First question, changed'), editedAt: AT },
    assistant('a-new', [{ type: 'text', text: 'Here is the answer.' }]),
  ]);
  expect(session.draftOf('u1')).toBeNull();
  expect(after.editor).toBeNull();
  expect(server.requests).toEqual([{ kind: 'edit', conversationId: 'c1', messageId: 'u1', text: 'First question, changed' }]);
});

const change = (status: 'awaiting_confirmation' | 'running' | 'succeeded' | 'failed' | 'cancelled') => ({ id: 'x', system: 'DCRS', summary: 'Start the record', status, error: null });
const card = (status: 'pending' | 'confirmed' | 'cancelled', ...changes: ReturnType<typeof change>[]): MessagePart => ({
  type: 'confirmation',
  id: 'card',
  expiresAt: AT,
  status,
  changes,
});
const lookup = (kind: 'read' | 'write', status: 'running' | 'succeeded' | 'failed' | 'cancelled'): MessagePart => ({ type: 'activity', id: 'act', system: 'DCRS', summary: 'A lookup', kind, status, error: null });
const after = (...parts: MessagePart[]): ChatMessage[] => [user('u1', 'Start the record'), assistant('a1', parts)];

it("keeps a message refused because the session had ended, for the same person's next sign-in, in its own chat", async () => {
  // DCRS ends the super admin's day at midnight, and the server then answers 401: the message used to be lost with the
  // screen (the review of 8-Oct-2026).
  const as = (who: string) => ({ call: <T,>(request: (token: string) => Promise<T>) => request('token'), changed: () => {}, busy: () => {}, who: () => who });
  const ENDED = 'Your session ended before this was sent. Send it again.';
  server.answer = async () => {
    throw new ApiError(401, 'session_expired', 'Your session has ended. Sign in again.');
  };
  const atMidnight = new ChatSession(as('u-admin'));
  atMidnight.send("Open today's pest control record", false, []);
  await finished(atMidnight);
  // Shown not sent, with why, while the screen still shows it.
  expect(atMidnight.getState().messages).toEqual([]);
  expect(atMidnight.getState().unsent).toMatchObject({ request: { kind: 'message', text: "Open today's pest control record" }, error: ENDED });

  // Nobody else signing in on this phone is shown it, and no other chat of his.
  expect(new ChatSession(as('u-staff')).getState().unsent).toBeNull();
  expect(new ChatSession(as('u-admin'), 'c1').getState().unsent).toBeNull();
  // He signs in again: his new chat has it, ready to send again - once.
  const again = new ChatSession(as('u-admin'));
  expect(again.getState().unsent).toMatchObject({ request: { kind: 'message', text: "Open today's pest control record" }, error: ENDED });
  expect(new ChatSession(as('u-admin')).getState().unsent).toBeNull();

  server.answer = async (_request, progress) => {
    progress({ type: 'start', conversationId: 'c-new', title: null, userMessage: user('u-new', "Open today's pest control record"), message: assistant('a-new', [], 'streaming') });
    return { conversationId: 'c-new', reply: 'Opened.', confirmation: null, message: assistant('a-new', [{ type: 'text', text: 'Opened.' }]), title: null };
  };
  again.resend();
  await finished(again);
  expect(server.requests.at(-1)).toMatchObject({ kind: 'message', text: "Open today's pest control record" });
  expect(again.getState().unsent).toBeNull();
  expect(again.getState().messages.map((message) => message.id)).toEqual(['u-new', 'a-new']);

  // A message in a saved conversation is kept for that conversation.
  server.answer = async () => {
    throw new ApiError(401, 'session_expired', 'Your session has ended. Sign in again.');
  };
  server.saved = { id: 'c1', title: 'Questions', messages: conversation(), createdAt: AT, updatedAt: AT };
  const saved = new ChatSession(as('u-admin'), 'c1');
  saved.load();
  await vi.waitFor(() => expect(saved.getState().history.status).toBe('ready'));
  saved.send('And the viscosity record', false, []);
  await finished(saved);
  expect(new ChatSession(as('u-admin')).getState().unsent).toBeNull();
  expect(new ChatSession(as('u-admin'), 'c1').getState().unsent).toMatchObject({ request: { kind: 'message', conversationId: 'c1', text: 'And the viscosity record' } });
});

it('says a message made changes only when something after it did, as the conversation is now', () => {
  // Waiting for a confirmation, or turned down, or failed: nothing was changed.
  expect(madeChangesAfter(after(card('pending', change('awaiting_confirmation'))), 'u1')).toBe(false);
  expect(madeChangesAfter(after(card('cancelled', change('cancelled'))), 'u1')).toBe(false);
  expect(madeChangesAfter(after(card('confirmed', change('failed'), change('cancelled'))), 'u1')).toBe(false);
  // The same card once its change ran, or is running: it was.
  expect(madeChangesAfter(after(card('confirmed', change('succeeded'))), 'u1')).toBe(true);
  expect(madeChangesAfter(after(card('confirmed', change('running'))), 'u1')).toBe(true);
  expect(madeChangesAfter(after(card('confirmed', change('succeeded'), change('failed'))), 'u1')).toBe(true);
  // Lookups that wrote count; lookups that only read, or that did not run, do not.
  expect(madeChangesAfter(after(lookup('write', 'succeeded')), 'u1')).toBe(true);
  expect(madeChangesAfter(after(lookup('read', 'succeeded')), 'u1')).toBe(false);
  expect(madeChangesAfter(after(lookup('write', 'failed')), 'u1')).toBe(false);
  // Only what comes after the message counts, and a message that is not there has nothing after it.
  const earlier: ChatMessage[] = [assistant('a0', [lookup('write', 'succeeded')]), user('u1', 'Then this')];
  expect(madeChangesAfter(earlier, 'u1')).toBe(false);
  expect(madeChangesAfter(after(lookup('write', 'succeeded')), 'nobody')).toBe(false);
});

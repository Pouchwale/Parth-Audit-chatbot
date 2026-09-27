import type { AssistantMessage, AssistantReply, ChatMessage, ConversationDetail, UserMessage } from '@shared/api';
import { api, ApiError, errorMessage } from './api';
import { streamChat, type ChatRequest, type ProgressEvent } from './chat-stream';
import { appendText, setPart, withoutWaiting } from './transcript';

export type HistoryState = { status: 'ready' } | { status: 'loading' } | { status: 'failed'; error: string; gone: boolean };

export interface ChatState {
  /** Set once the server has created the conversation. */
  conversationId: string | null;
  title: string | null;
  messages: readonly ChatMessage[];
  /** The saved conversation: loading, shown, or why it couldn't be loaded. */
  history: HistoryState;
  /** The request being answered. */
  running: ChatRequest | null;
  /** Stop was pressed before the server started the reply; it takes effect once the server has. */
  stopping: boolean;
  /**
   * A reply shown here is out of date while the server finishes it: one this device stopped or lost the
   * connection to, or one another device is writing. It is loaded again once it is done.
   */
  settling: boolean;
  /** A request that failed before its reply started, so it can be sent again. */
  unsent: { request: ChatRequest; spoken: boolean; error: string } | null;
}

export interface FinishedReply {
  reply: AssistantReply;
  /** The person spoke the request rather than typing or tapping it. */
  spoken: boolean;
}

export interface ChatSessionDeps {
  call<T>(request: (token: string) => Promise<T>): Promise<T>;
  /** Something the history list shows may have changed. */
  changed(): void;
  /** A request started (true) or finished (false). */
  busy(session: ChatSession, busy: boolean): void;
}

interface Attempt {
  /** The server has started the reply. */
  started: boolean;
  /** The person's message as shown before the server saved it. */
  localUserId: string | null;
}

// Streamed text reaches the screen in batches: re-rendering, and re-parsing the markdown, for every token is
// too slow on low-end phones.
const BATCH_MS = 50;

// The transcript on screen is out of date: the server has already moved on.
const STALE = new Set(['confirmation_not_pending', 'nothing_to_retry']);

// The server finishes lookups and confirmed changes even when nobody is listening any more, so a reply out of
// date here is loaded again, at growing intervals, until the server is done with it.
const SETTLE_FIRST_MS = 500;
const SETTLE_MAX_MS = 10_000;

let localIds = 0;

/** One conversation on screen: its messages, and the request being answered. Outlives the screens that show it. */
export class ChatSession {
  private state: ChatState;
  private readonly deps: ChatSessionDeps;
  private readonly listeners = new Set<() => void>();
  private readonly replyListeners = new Set<(finished: FinishedReply) => void>();
  private controller: AbortController | null = null;
  private attempt: Attempt | null = null;
  /** The assistant message the running request writes. */
  private writing: string | null = null;
  private batch: ReturnType<typeof setTimeout> | null = null;
  /** The saved conversation has been asked for. A new chat has nothing saved, even once it has an id. */
  private historyRequested: boolean;
  /** The replies that make the conversation `settling`. */
  private unsettled = new Set<string>();
  private settleTries = 0;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: ChatSessionDeps, conversationId?: string) {
    this.deps = deps;
    this.historyRequested = !conversationId;
    this.state = {
      conversationId: conversationId ?? null,
      title: null,
      messages: [],
      history: conversationId ? { status: 'loading' } : { status: 'ready' },
      running: null,
      stopping: false,
      settling: false,
      unsent: null,
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): ChatState => this.state;

  get conversationId(): string | null {
    return this.state.conversationId;
  }

  /** Calls `listener` with every reply that finishes. Returns the function that stops it. */
  onReply(listener: (finished: FinishedReply) => void): () => void {
    this.replyListeners.add(listener);
    return () => this.replyListeners.delete(listener);
  }

  /** Loads the saved conversation the first time it is asked for. */
  load(): void {
    if (this.historyRequested) return;
    this.historyRequested = true;
    void this.fetchHistory();
  }

  /** Loads the saved conversation again, e.g. after it failed to load. */
  reload(): void {
    void this.fetchHistory();
  }

  send(text: string, spoken: boolean): void {
    void this.run({ kind: 'message', conversationId: this.state.conversationId ?? undefined, text }, spoken);
  }

  decide(confirmationId: string, decision: 'confirm' | 'cancel', spoken: boolean): void {
    const { conversationId } = this.state;
    if (conversationId) void this.run({ kind: 'decision', conversationId, confirmationId, decision }, spoken);
  }

  /** Continues the last reply, which failed part-way. */
  retry(): void {
    const { conversationId } = this.state;
    if (conversationId) void this.run({ kind: 'retry', conversationId }, false);
  }

  /** Sends the request that couldn't be sent, again. */
  resend(): void {
    const { unsent } = this.state;
    if (unsent) void this.run(unsent.request, unsent.spoken);
  }

  /** Stops the reply being written. The server keeps what it has written so far. */
  stop(): void {
    if (!this.state.running) return;
    // The server saves the conversation and the message before it starts the reply. Stopping sooner would lose
    // track of them: a new chat's next message would start a second conversation.
    if (this.attempt?.started) this.controller?.abort();
    else this.update({ stopping: true });
  }

  /** Ends the request at once, whether or not its reply has started: for signing out. */
  abandon(): void {
    this.controller?.abort();
  }

  private async run(request: ChatRequest, spoken: boolean): Promise<void> {
    if (this.state.running) return;
    const controller = new AbortController();
    this.controller = controller;
    const attempt = this.begin(request);
    this.attempt = attempt;
    this.deps.busy(this, true);
    try {
      const reply = await this.deps.call((token) => streamChat(token, request, (event) => this.progress(event, attempt), controller.signal));
      this.finish(reply);
      for (const listener of this.replyListeners) listener({ reply, spoken });
    } catch (error) {
      if (controller.signal.aborted) this.endWriting('stopped');
      else if (error instanceof ApiError && error.status === 401) return; // Signed out: the sign-in screen says why.
      else if (attempt.started) this.endWriting('error', errorMessage(error));
      else return this.notSent(request, spoken, attempt, error);
      if (attempt.started && this.writing) this.unsettled.add(this.writing);
    } finally {
      this.controller = null;
      this.attempt = null;
      this.writing = null;
      this.update({ running: null, stopping: false, settling: this.unsettled.size > 0 });
      this.deps.busy(this, false);
      this.deps.changed();
      if (this.unsettled.size > 0) this.settleSoon();
    }
  }

  /** Shows the request straight away: the person's message and an empty reply, or the reply being retried. */
  private begin(request: ChatRequest): Attempt {
    const attempt: Attempt = { started: false, localUserId: null };
    let { messages } = this.state;
    if (request.kind === 'message') {
      const id = ++localIds;
      const createdAt = new Date().toISOString();
      const user: UserMessage = { id: `local-user-${id}`, role: 'user', text: request.text, createdAt };
      const reply: AssistantMessage = { id: `local-reply-${id}`, role: 'assistant', parts: [], status: 'streaming', error: null, createdAt };
      attempt.localUserId = user.id;
      this.writing = reply.id;
      messages = [...messages, user, reply];
    } else if (request.kind === 'retry') {
      const target = messages.findLast((message): message is AssistantMessage => message.role === 'assistant');
      if (target) {
        const retried: AssistantMessage = { ...target, status: 'streaming', error: null };
        this.writing = target.id;
        messages = messages.map((message) => (message === target ? retried : message));
      }
    }
    this.update({ messages, running: request, unsent: null });
    return attempt;
  }

  private progress(event: ProgressEvent, attempt: Attempt): void {
    switch (event.type) {
      case 'start': {
        attempt.started = true;
        const { conversationId, title, userMessage, message } = event;
        const replacements = new Map<string, ChatMessage>([[this.writing ?? message.id, message]]);
        if (attempt.localUserId && userMessage) replacements.set(attempt.localUserId, userMessage);
        this.writing = message.id;
        // A new message drops the confirmation still waiting, as the server has done by now. A reply shown out of
        // date stays as it is until it has been loaded again.
        const dropWaiting = (existing: ChatMessage) =>
          userMessage && !this.unsettled.has(existing.id) ? withoutWaiting(existing) : existing;
        this.update({
          conversationId,
          title: title ?? this.state.title,
          messages: this.state.messages.map((existing) => replacements.get(existing.id) ?? dropWaiting(existing)),
        });
        if (this.state.stopping) this.controller?.abort();
        this.deps.changed();
        return;
      }
      case 'delta':
        return this.editWriting((message) => appendText(message, event.text), 'soon');
      case 'part':
        return this.editWriting((message) => setPart(message, event.index, event.part), 'soon');
      case 'title':
        this.update({ title: event.title });
        this.deps.changed();
        return;
    }
  }

  private finish(reply: AssistantReply): void {
    this.update({
      conversationId: reply.conversationId,
      title: reply.title ?? this.state.title,
      messages: this.state.messages.map((message) => (message.id === reply.message.id ? reply.message : message)),
    });
  }

  /** Ends the reply being written, when it didn't finish normally. */
  private endWriting(status: 'stopped' | 'error', error: string | null = null): void {
    this.editWriting((message) => (message.status === 'streaming' ? { ...message, status, error } : message), 'now');
  }

  private notSent(request: ChatRequest, spoken: boolean, attempt: Attempt, error: unknown): void {
    if (error instanceof ApiError && STALE.has(error.code)) return this.reload();
    if (request.kind === 'retry') return this.endWriting('error', errorMessage(error));
    const shown = new Set([attempt.localUserId, this.writing]);
    this.update({
      messages: this.state.messages.filter((message) => !shown.has(message.id)),
      unsent: { request, spoken, error: errorMessage(error) },
    });
  }

  private editWriting(change: (message: AssistantMessage) => AssistantMessage, when: 'now' | 'soon'): void {
    const id = this.writing;
    this.update(
      { messages: this.state.messages.map((message) => (message.id === id && message.role === 'assistant' ? change(message) : message)) },
      when,
    );
  }

  private async fetchHistory(): Promise<void> {
    const id = this.state.conversationId;
    if (!id) return;
    // A conversation already on screen stays there while it refreshes.
    if (this.state.messages.length === 0) this.update({ history: { status: 'loading' } });
    try {
      const detail = await this.deps.call((token) => api.conversation(token, id));
      // A request that started meanwhile has newer messages than this copy.
      if (this.state.running) return;
      this.show(detail);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return;
      if (this.state.messages.length > 0) return;
      const gone = error instanceof ApiError && error.status === 404;
      this.update({ history: { status: 'failed', error: errorMessage(error), gone } });
    }
  }

  /** Shows the conversation as saved, and keeps loading it while a reply in it is still being written. */
  private show(detail: ConversationDetail): void {
    this.unsettled = new Set(detail.messages.filter(isWriting).map((message) => message.id));
    const settling = this.unsettled.size > 0;
    this.update({ title: detail.title, messages: detail.messages, history: { status: 'ready' }, settling });
    if (settling) this.settleSoon();
  }

  private settleSoon(): void {
    this.settleTries = 0;
    this.settleLater();
  }

  private settleLater(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    const delay = Math.min(SETTLE_MAX_MS, SETTLE_FIRST_MS * 2 ** this.settleTries++);
    this.settleTimer = setTimeout(() => void this.settle(), delay);
  }

  /** Loads the conversation again once the server has finished the replies that are out of date here. */
  private async settle(): Promise<void> {
    this.settleTimer = null;
    const id = this.state.conversationId;
    // No screen shows the conversation any more. A request that is running checks again when it ends.
    if (!id || this.listeners.size === 0 || this.state.running) return;
    try {
      const detail = await this.deps.call((token) => api.conversation(token, id));
      if (this.state.running) return;
      if (detail.messages.some((message) => this.unsettled.has(message.id) && isWriting(message))) return this.settleLater();
      this.show(detail);
    } catch (error) {
      // Signed out, or the conversation was deleted.
      if (error instanceof ApiError && (error.status === 401 || error.status === 404)) return;
      this.settleLater();
    }
  }

  private update(changes: Partial<ChatState>, when: 'now' | 'soon' = 'now'): void {
    this.state = { ...this.state, ...changes };
    if (when === 'now') return this.emit();
    this.batch ??= setTimeout(() => this.emit(), BATCH_MS);
  }

  private emit(): void {
    if (this.batch) clearTimeout(this.batch);
    this.batch = null;
    for (const listener of this.listeners) listener();
  }
}

function isWriting(message: ChatMessage): boolean {
  return message.role === 'assistant' && message.status === 'streaming';
}

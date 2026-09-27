import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type Groq from 'groq-sdk';
import { z } from 'zod';
import type { DeviceInfo, LoginResponse, StreamEvent } from '@shared/api.ts';
import type { Model, ModelOptions, ModelRequest } from '../src/agent/model.ts';
import type { Titler } from '../src/agent/titles.ts';
import { buildApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import { createRegistry } from '../src/connectors/registry.ts';
import { ConnectorError, defineAction, type Connector } from '../src/connectors/types.ts';
import { openDatabase, type Database } from '../src/db/index.ts';
import type { Recording } from '../src/voice/transcriber.ts';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    host: '127.0.0.1',
    databaseUrl: 'memory://',
    credentialsKey: randomBytes(32),
    superAdmins: new Set(['admin']),
    sessionTtlMs: 30 * 24 * 3600_000,
    confirmationTtlMs: 10 * 60_000,
    conversationRetentionMs: 24 * 3600_000,
    groqApiKey: undefined,
    model: 'test-model',
    reasoningEffort: '',
    titleModel: 'test-title-model',
    transcriptionModel: 'test-transcription-model',
    dcrsBaseUrl: undefined,
    trustProxy: false,
    corsOrigins: [],
    ...overrides,
  };
}

interface Item {
  id: string;
  title: string;
  status: 'open' | 'closed';
}

/** A pretend connected system with a few items that can be listed and closed. */
export function fakeSystem() {
  const items = new Map<string, Item>([
    ['12', { id: '12', title: 'Fire exit blocked', status: 'open' }],
    ['13', { id: '13', title: 'Missing calibration label', status: 'open' }],
  ]);
  const calls: { action: string; credentials: unknown; input: unknown }[] = [];
  // lookupRunning, when set, holds each lookup until it resolves.
  const state: { acceptsSignIn: boolean; lookupRunning?: Promise<void> } = { acceptsSignIn: true };
  const passwords: Record<string, string> = { alice: 'alice-pw', bob: 'bob-pw', admin: 'admin-pw' };

  const connector: Connector = {
    id: 'fake',
    name: 'Fake Records',
    description: 'A test system with items.',
    examples: ['What is open?', 'Close item 12'],
    actions: [
      defineAction({
        name: 'list_items',
        description: 'Lists items.',
        kind: 'read',
        input: z.object({ status: z.enum(['open', 'closed']).optional() }),
        describe: (input) => `List ${input.status ?? 'all'} items`,
        run: async (ctx, input) => {
          calls.push({ action: 'list_items', credentials: ctx.credentials, input });
          await state.lookupRunning;
          if (!state.acceptsSignIn) throw new ConnectorError('unauthorized', 'Your Fake Records sign-in has expired.');
          return [...items.values()].filter((item) => !input.status || item.status === input.status);
        },
      }),
      defineAction({
        name: 'close_item',
        description: 'Closes an item.',
        kind: 'write',
        input: z.object({ id: z.string(), note: z.string() }),
        describe: (input) => `Close item ${input.id} with the note "${input.note}"`,
        run: async (ctx, input) => {
          calls.push({ action: 'close_item', credentials: ctx.credentials, input });
          const item = items.get(input.id);
          if (!item) throw new ConnectorError('not_found', `Item ${input.id} doesn't exist.`);
          item.status = 'closed';
          return item;
        },
      }),
    ],
    async authenticate(username, password) {
      if (passwords[username] !== password) throw new ConnectorError('invalid_credentials', 'Wrong username or password.');
      return {
        externalId: `ext-${username}`,
        username,
        displayName: username.charAt(0).toUpperCase() + username.slice(1),
        credentials: { token: `token-${username}` },
      };
    },
  };
  return { connector, items, calls, state };
}

type Step = (request: ModelRequest, options: ModelOptions) => Groq.Chat.ChatCompletion | Promise<Groq.Chat.ChatCompletion>;
let nextId = 0;

/** Stands in for the model: returns queued responses in order and records every request. */
export function scriptedModel() {
  const requests: ModelRequest[] = [];
  const steps: Step[] = [];
  const model: Model = async (request, options = {}) => {
    requests.push(structuredClone(request));
    const step = steps.shift();
    if (!step) throw new Error('The model was called more times than the test expected');
    return step(request, options);
  };
  return { model, requests, queue: (...more: Step[]) => steps.push(...more) };
}

export function says(text: string): Step {
  return () => completion({ role: 'assistant', content: text }, 'stop');
}

/** Writes its reply in pieces, the way the real model streams. */
export function streams(...pieces: string[]): Step {
  return (_request, { onText }) => {
    for (const piece of pieces) onText?.(piece);
    return completion({ role: 'assistant', content: pieces.join('') }, 'stop');
  };
}

/** Writes part of a reply and then runs into the length limit. */
export function cutOff(...pieces: string[]): Step {
  return (_request, { onText }) => {
    for (const piece of pieces) onText?.(piece);
    return completion({ role: 'assistant', content: pieces.join('') }, 'length');
  };
}

export function callsTool(name: string, input: Record<string, unknown>, text?: string): Step {
  return callsTools([[name, input]], text);
}

/** One response that calls several tools. */
export function callsTools(calls: [name: string, input: Record<string, unknown>][], text?: string): Step {
  return () =>
    completion(
      {
        role: 'assistant',
        content: text ?? null,
        tool_calls: calls.map(([name, input]) => ({ id: `call_${++nextId}`, type: 'function', function: { name, arguments: JSON.stringify(input) } })),
      },
      'tool_calls',
    );
}

export function fails(error: Error): Step {
  return () => {
    throw error;
  };
}

function completion(message: Groq.Chat.ChatCompletionMessage, finishReason: 'stop' | 'tool_calls' | 'length'): Groq.Chat.ChatCompletion {
  return {
    id: `chatcmpl_${++nextId}`,
    object: 'chat.completion',
    created: 0,
    model: 'test-model',
    choices: [{ index: 0, message, finish_reason: finishReason, logprobs: null }],
  } as Groq.Chat.ChatCompletion;
}

export interface LoginOptions {
  ip?: string;
  password?: string;
  device?: Partial<DeviceInfo>;
}

// Starting PGlite takes seconds, so each test file shares one in-memory database and empties it per test.
let shared: Promise<Database> | undefined;

async function emptyDatabase(): Promise<Database> {
  shared ??= openDatabase('memory://');
  const database = await shared;
  await database.db.execute(sql`truncate users, sessions, connector_credentials, login_events, conversations, actions cascade`);
  return database;
}

/** Stands in for Whisper: records each recording and answers with `state.text`, or fails with `state.error`. */
function fakeTranscriber() {
  const recordings: Recording[] = [];
  const state: { text: string; error?: Error } = { text: 'What is still open?' };
  const transcriber = async (audio: Recording) => {
    recordings.push(audio);
    if (state.error) throw state.error;
    return state.text;
  };
  return { recordings, state, transcriber };
}

export async function setup(overrides: Partial<Config> = {}, options: { titler?: Titler } = {}) {
  const config = testConfig(overrides);
  const database = await emptyDatabase();
  const system = fakeSystem();
  const scripted = scriptedModel();
  const voice = fakeTranscriber();
  const registry = createRegistry([system.connector], 'fake');
  const app = await buildApp(
    { config, db: database.db, registry, model: scripted.model, transcriber: voice.transcriber, ...options },
    { logger: false },
  );

  function login(username: string, options: LoginOptions = {}) {
    return app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: options.ip ?? '203.0.113.10',
      headers: { 'user-agent': 'AuditAssistant/1.0 test' },
      payload: {
        username,
        password: options.password ?? `${username}-pw`,
        device: {
          deviceId: `device-${username}`,
          name: `${username}'s phone`,
          model: 'Pixel 8',
          os: 'Android',
          osVersion: '16',
          appVersion: '1.0.0',
          ...options.device,
        },
      },
    });
  }

  async function signIn(username: string, options?: LoginOptions): Promise<string> {
    const response = await login(username, options);
    if (response.statusCode !== 200) throw new Error(`Sign-in failed: ${response.body}`);
    return response.json<LoginResponse>().token;
  }

  function as(token: string) {
    const headers = { authorization: `Bearer ${token}` };
    return {
      get: (url: string) => app.inject({ method: 'GET', url, headers }),
      post: (url: string, payload?: object) => app.inject({ method: 'POST', url, headers, ...(payload ? { payload } : {}) }),
      patch: (url: string, payload: object) => app.inject({ method: 'PATCH', url, headers, payload }),
      delete: (url: string) => app.inject({ method: 'DELETE', url, headers }),
    };
  }

  return {
    app,
    db: database.db,
    system,
    model: scripted,
    voice,
    login,
    signIn,
    as,
    close: () => app.close(),
  };
}

/** The events in a server-sent event stream, in order, checking that each frame's event name matches its type. */
export function parseEvents(payload: string): StreamEvent[] {
  return payload
    .split('\n\n')
    .filter((frame) => frame.startsWith('event:'))
    .map((frame) => {
      const [name, data] = frame.split('\n');
      const event = JSON.parse(data!.slice('data: '.length)) as StreamEvent;
      if (name !== `event: ${event.type}`) throw new Error(`Frame "${name}" carries a ${event.type} event`);
      return event;
    });
}

export function findEvent<T extends StreamEvent['type']>(events: StreamEvent[], type: T): Extract<StreamEvent, { type: T }> {
  const event = events.find((e): e is Extract<StreamEvent, { type: T }> => e.type === type);
  if (!event) throw new Error(`The stream has no ${type} event`);
  return event;
}

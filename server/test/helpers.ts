import { randomBytes } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DeviceInfo, LoginResponse } from '@shared/api.ts';
import type { Model, ModelRequest } from '../src/agent/model.ts';
import { buildApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import { createRegistry } from '../src/connectors/registry.ts';
import { ConnectorError, defineAction, type Connector } from '../src/connectors/types.ts';
import { openDatabase, type Database } from '../src/db/index.ts';

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
    model: 'test-model',
    effort: '',
    fallbacks: '',
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
  const state = { acceptsSignIn: true };
  const passwords: Record<string, string> = { alice: 'alice-pw', bob: 'bob-pw', admin: 'admin-pw' };

  const connector: Connector = {
    id: 'fake',
    name: 'Fake Records',
    description: 'A test system with items.',
    actions: [
      defineAction({
        name: 'list_items',
        description: 'Lists items.',
        kind: 'read',
        input: z.object({ status: z.enum(['open', 'closed']).optional() }),
        describe: (input) => `List ${input.status ?? 'all'} items`,
        run: async (ctx, input) => {
          calls.push({ action: 'list_items', credentials: ctx.credentials, input });
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

type Step = (request: ModelRequest) => Anthropic.Beta.BetaMessage;
let nextId = 0;

/** Stands in for Claude: returns queued responses in order and records every request. */
export function scriptedModel() {
  const requests: ModelRequest[] = [];
  const steps: Step[] = [];
  const model: Model = async (request) => {
    requests.push(structuredClone(request));
    const step = steps.shift();
    if (!step) throw new Error('The model was called more times than the test expected');
    return step(request);
  };
  return { model, requests, queue: (...more: Step[]) => steps.push(...more) };
}

export function says(text: string): Step {
  return () => modelMessage([{ type: 'text', text, citations: null }], 'end_turn');
}

export function callsTool(name: string, input: Record<string, unknown>, text?: string): Step {
  return () =>
    modelMessage(
      [...(text ? [{ type: 'text', text, citations: null }] : []), { type: 'tool_use', id: `toolu_${++nextId}`, name, input }],
      'tool_use',
    );
}

export function fails(error: Error): Step {
  return () => {
    throw error;
  };
}

function modelMessage(content: unknown[], stopReason: string): Anthropic.Beta.BetaMessage {
  return {
    id: `msg_${++nextId}`,
    type: 'message',
    role: 'assistant',
    model: 'test-model',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Anthropic.Beta.BetaMessage;
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

export async function setup(overrides: Partial<Config> = {}) {
  const config = testConfig(overrides);
  const database = await emptyDatabase();
  const system = fakeSystem();
  const scripted = scriptedModel();
  const registry = createRegistry([system.connector], 'fake');
  const app = await buildApp({ config, db: database.db, registry, model: scripted.model }, { logger: false });

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
    };
  }

  return {
    app,
    db: database.db,
    system,
    model: scripted,
    login,
    signIn,
    as,
    close: () => app.close(),
  };
}

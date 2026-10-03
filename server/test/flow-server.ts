// A Mitra server for driving the app without Groq: the real server, the DCRS connector on DCRS_BASE, an in-memory
// database, and a scripted model with fixed behaviours, so the app's chat can be tested end to end.
//
//   DCRS_BASE=http://127.0.0.1:4000 node --no-warnings server/test/flow-server.ts [--port 8899] [--origin http://localhost:8081]
//
// People sign in with their DCRS email and password, as always. What the model does with a message:
//   anything        → a short echo of the words, streamed in pieces
//   "due today"     → the today lookup, then a streamed summary of it
//   "start <fmt>"   → one card with two steps: open the day's record of <fmt>, then fill it with sample data; once
//                     confirmed, a streamed "Done"
//   "long"          → about 6,000 characters in about 300 pieces, 30 ms apart, with a table, a list and a code block
//   "busy"          → the waiting status for about 5 seconds, then an answer
//   "fail"          → a few words, then an error (the reply is saved as failed); Retry then works
// --port picks the port (8899 unless given), --origin the web origin allowed to call it (CORS; * for any).
import { randomBytes } from 'node:crypto';
import Groq from 'groq-sdk';
import { buildApp } from '../src/app.ts';
import type { Model, ModelOptions, ModelRequest } from '../src/agent/model.ts';
import { loadConfig } from '../src/config.ts';
import { createDcrsConnector } from '../src/connectors/dcrs/index.ts';
import { createRegistry } from '../src/connectors/registry.ts';
import { openDatabase } from '../src/db/index.ts';

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1]! : fallback;
};
const port = Number(option('port', '8899'));
const origin = option('origin', 'http://localhost:8081');
const dcrsBase = process.env.DCRS_BASE ?? process.env.DCRS_BASE_URL;
if (!dcrsBase) {
  console.error('Set DCRS_BASE to the DCRS server to sign people in with, such as http://127.0.0.1:4000.');
  process.exit(2);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let ids = 0;
/** The "fail" requests that have failed once already, so Retry succeeds. */
const failedOnce = new Set<string>();

type Message = ModelRequest['messages'][number];

function completion(message: Partial<Groq.Chat.ChatCompletionMessage>, finish: 'stop' | 'tool_calls'): Groq.Chat.ChatCompletion {
  return {
    id: `chatcmpl_${++ids}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'scripted',
    choices: [{ index: 0, message: { role: 'assistant', content: null, ...message }, finish_reason: finish, logprobs: null }],
  } as Groq.Chat.ChatCompletion;
}

/** Streams `text` in pieces of about `size` characters, `gapMs` apart, then answers with it whole. */
async function stream(text: string, { onText, signal }: ModelOptions, size = 24, gapMs = 20): Promise<Groq.Chat.ChatCompletion> {
  for (let at = 0; at < text.length; at += size) {
    if (signal?.aborted) throw new Groq.APIUserAbortError();
    onText?.(text.slice(at, at + size));
    await sleep(gapMs);
  }
  return completion({ content: text }, 'stop');
}

function calls(list: [name: string, input: Record<string, unknown>][]): Groq.Chat.ChatCompletion {
  return completion(
    { content: null, tool_calls: list.map(([name, input]) => ({ id: `call_${++ids}`, type: 'function', function: { name, arguments: JSON.stringify(input) } })) },
    'tool_calls',
  );
}

/** The person's latest words in the request, lowercased, and whether tools have already answered since. */
function situation(messages: readonly Message[]) {
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const text = String((messages[lastUser] as { content?: unknown } | undefined)?.content ?? '')
    .split('\n')[0]!
    .trim();
  const answered = messages.slice(lastUser + 1).some((m) => m.role === 'tool');
  const results = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  return { text, lower: text.toLowerCase(), answered, results };
}

/** About 6,000 characters of markdown: a table, a list and a code block, as a long answer would have. */
function longAnswer(): string {
  const rows = Array.from({ length: 24 }, (_, i) => `| ${String(i + 1).padStart(2, '0')}:00 | ${(19 + (i % 3) * 0.7).toFixed(1)} s | ${['Kapila', 'Roshni', 'Vinay'][i % 3]} | ${i % 5 === 0 ? 'Checked twice' : 'OK'} |`);
  const list = Array.from({ length: 12 }, (_, i) => `- Reading ${i + 1}: the adhesive was within range at ${19 + (i % 4) * 0.5} seconds, and the tester signed the line.`);
  const parts = [
    "Here is today's **F-QC-30** viscosity record in full, as DCRS has it now. It is still a draft: nothing has been submitted yet.",
    '',
    '| Hour | Viscosity | Tested by | Remark |',
    '|---|---|---|---|',
    ...rows,
    '',
    'What stood out on each line:',
    '',
    ...list,
    '',
    'The patch DCRS took for the last change was:',
    '',
    '```json',
    JSON.stringify({ itemEdits: [{ collection: 'rows', match: { row: 24 }, set: { viscosity: '20.4', testedBy: 'Kapila', remark: 'OK' } }] }, null, 2),
    '```',
    '',
  ];
  let text = parts.join('\n');
  while (text.length < 6_000) text += '\nEvery reading is within the 18 to 22 second range the format allows, so the record can be submitted when the shift ends.';
  return text;
}

const model: Model = async (request, options = {}) => {
  const { text, lower, answered, results } = situation(request.messages);
  if (lower.includes('due today')) {
    if (!answered) return calls([['dcrs__todays_facts', {}]]);
    const today = results.map((m) => String((m as { content?: unknown }).content ?? '')).join(' ');
    const due = /"due":\s*(\[|\{)/.test(today) ? 'The lookup answered: see the records it lists as due.' : 'Nothing is listed as due.';
    return stream(`Here is today. ${due} Overdue work, if any, comes first in the lookup above, then what is due today.`, options);
  }
  const start = /^start\s+(.+)$/i.exec(text);
  if (start && !answered) {
    const format = start[1]!.replace(/^today'?s\s+/i, '').replace(/\s+record$/i, '').trim();
    return calls([
      ['dcrs__open_record', { documentId: format }],
      ['dcrs__fill_record_with_sample_data', { documentId: format }],
    ]);
  }
  if (answered) {
    const failed = results.some((m) => /"error"/.test(String((m as { content?: unknown }).content ?? '')));
    return stream(failed ? "Not all of that could be done. The card above says what was and was not done." : "Done. The record is started and filled with sample data, marked as made up. It is still a draft.", options);
  }
  if (lower === 'long') return stream(longAnswer(), options, 20, 30);
  if (lower === 'busy') {
    options.onWait?.(5_000);
    try {
      await sleep(5_000);
    } finally {
      options.onWait?.(null);
    }
    return stream('Sorry about the wait. The model was busy for a moment; it is free again now.', options);
  }
  if (lower === 'fail') {
    // The first time; Retry, which sends the same request again, then works.
    const key = JSON.stringify(request.messages);
    if (!failedOnce.has(key)) {
      failedOnce.add(key);
      options.onText?.('Let me look that ');
      await sleep(300);
      throw new Groq.APIConnectionError({ message: 'The connection to Groq was lost.' });
    }
    return stream('That worked the second time. The first try failed on purpose, so Retry could be tested.', options);
  }
  return stream(`You said: "${text}". This is the flow server, so there is no real model behind this reply.`, options);
};

const config = loadConfig({
  CREDENTIALS_KEY: randomBytes(32).toString('base64'),
  DATABASE_URL: 'memory://',
  DCRS_BASE_URL: dcrsBase,
  PORT: String(port),
  HOST: '127.0.0.1',
  CORS_ORIGINS: origin,
  REPORT_TIME_ZONE: 'Asia/Kolkata',
  SUPER_ADMINS: 'admin@gpp.local',
});
const database = await openDatabase('memory://');
const registry = createRegistry([createDcrsConnector({ baseUrl: dcrsBase })], 'dcrs');
const app = await buildApp(
  { config, db: database.db, registry, model, transcriber: async () => 'What is due today?', imageReader: async () => 'A photo of a record sheet.' },
  { logger: { level: 'info' } },
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await database.close();
    process.exit(0);
  });
}
const address = await app.listen({ port, host: '127.0.0.1' });
console.log(`[flow-server] READY ${address} (DCRS ${dcrsBase}; web origin ${origin})`);

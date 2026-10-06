// The request a typical turn sends the model, as the server builds it, and its size.
//   node --no-warnings server/test/request-size.ts [out.json]
// Prints the characters and the estimated tokens of the standing instructions, the tools, the note that differs by
// person and day, and a short history, as one request. About 3.9 characters make a token of English and JSON in
// gpt-oss's tokenizer; Groq renders the tools as signatures rather than JSON, which is shorter than what is counted
// here. The orchestrator's count_tokens.py gives the exact o200k_base count for the file this writes.
import { writeFileSync } from 'node:fs';
import type { ReplyLanguage } from '@shared/api.ts';
import { toolDefinitions } from '../src/agent/agent.ts';
import { wireMessages, type ModelRequest } from '../src/agent/model.ts';
import { systemPrompt, turnContext } from '../src/agent/prompt.ts';
import { createDcrsConnector } from '../src/connectors/dcrs/index.ts';
import { createRegistry } from '../src/connectors/registry.ts';

/** About how many characters make a token, for the estimate. */
export const CHARS_PER_TOKEN = 3.9;

export interface Person {
  displayName: string;
  username: string;
  now: Date;
  timeZone: string;
  /** The language they chose for replies in the app's settings. */
  replyLanguage?: ReplyLanguage;
}

/** The request the server sends for `person` asking `history`, against a DCRS connector. */
export function typicalRequest(person: Person, history: ModelRequest['messages'] = [{ role: 'user', content: 'What records are due today?' }]): ModelRequest {
  const registry = createRegistry([createDcrsConnector({ baseUrl: 'http://dcrs.test:4000' })], 'dcrs');
  return {
    system: systemPrompt(registry.connectors),
    tools: toolDefinitions(registry),
    context: turnContext(person),
    messages: history,
  };
}

export interface Sizes {
  system: number;
  tools: number;
  context: number;
  history: number;
  total: number;
  /** The part that is the same for everyone, every day: what Groq can keep from one request to the next. */
  staticPrefix: number;
  estimatedTokens: number;
}

/** The sizes of a request in characters, as it goes on the wire, and the estimated tokens. */
export function sizesOf(request: ModelRequest): Sizes {
  const system = request.system.length;
  const tools = JSON.stringify(request.tools).length;
  const context = request.context?.length ?? 0;
  const history = JSON.stringify(request.messages).length;
  const total = system + tools + context + history;
  return { system, tools, context, history, total, staticPrefix: system + tools, estimatedTokens: Math.round(total / CHARS_PER_TOKEN) };
}

const main = process.argv[1]?.replace(/\\/g, '/').endsWith('/test/request-size.ts');
if (main) {
  const request = typicalRequest({ displayName: 'Kapila Barad', username: 'kapila.barad@gpp.local', now: new Date(), timeZone: 'Asia/Kolkata' });
  const sizes = sizesOf(request);
  for (const [name, chars] of Object.entries(sizes)) console.log(`${name.padEnd(16)} ${String(chars).padStart(7)}${name === 'estimatedTokens' ? ' tokens' : ' chars'}`);
  const out = process.argv[2];
  if (out) {
    writeFileSync(out, JSON.stringify({ system: request.system, tools: request.tools, messages: wireMessages(request).slice(1) }, null, 1));
    console.log(`written to ${out}`);
  }
}

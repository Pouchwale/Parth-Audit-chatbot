import type { FastifyBaseLogger } from 'fastify';
import type Groq from 'groq-sdk';
import type { Config } from '../config.ts';
import { shorten } from './transcript.ts';

/** Names a conversation after its first message. Tests swap in a fake. */
export type Titler = (firstMessage: string) => Promise<string>;

// "Using its key words" keeps a small model from paraphrasing domain terms away (it named a request about
// findings "Open Research Questions").
const INSTRUCTIONS = 'Write a 2-6 word title for a conversation that starts with this request, using its key words. Reply with the title only.';

export function groqTitler(config: Config, groq: () => Groq): Titler {
  return async (firstMessage) => {
    const completion = await groq().chat.completions.create(
      {
        model: config.titleModel,
        messages: [
          { role: 'system', content: INSTRUCTIONS },
          { role: 'user', content: firstMessage },
        ],
        reasoning_effort: 'low',
        // Reasoning counts toward this (about 40 tokens at low effort), leaving room for a short title.
        max_completion_tokens: 100,
      },
      // The first reply waits for the title, so a slow title gives way to the fallback.
      { timeout: 10_000, maxRetries: 0 },
    );
    const choice = completion.choices[0];
    // A title cut off part-way is no title.
    return choice?.finish_reason === 'stop' ? (choice.message.content ?? '') : '';
  };
}

/** A title for a new conversation: the titler's, or the start of the first message when it has none. Never fails. */
export async function titleFor(titler: Titler | undefined, firstMessage: string, log: FastifyBaseLogger): Promise<string> {
  try {
    const title = titler ? clean(await titler(firstMessage)) : '';
    if (title) return title;
  } catch (error) {
    log.warn({ err: error }, 'could not generate a conversation title');
  }
  return shorten(firstMessage, 40);
}

function clean(title: string): string {
  return shorten(title.replace(/^[\s"'`*_“”‘’.,:;!?-]+|[\s"'`*_“”‘’.,:;!?-]+$/g, ''), 60);
}

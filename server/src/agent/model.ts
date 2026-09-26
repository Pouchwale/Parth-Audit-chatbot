import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../config.ts';

export interface ModelRequest {
  system: string;
  tools: Anthropic.Beta.BetaTool[];
  messages: Anthropic.Beta.BetaMessageParam[];
}

/** One call to the model. Tests swap in a scripted fake. */
export type Model = (request: ModelRequest) => Promise<Anthropic.Beta.BetaMessage>;

export function claudeModel(config: Config): Model {
  // Created on first use, so the server can start (and people can sign in) before a key is configured.
  let client: Anthropic | undefined;
  return (request) => {
    client ??= new Anthropic({ timeout: 60_000 });
    return client.beta.messages.create({
      model: config.model,
      max_tokens: 16000,
      // If the model declines for policy reasons, the API retries on its recommended fallback model.
      ...(config.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: config.fallbacks } : {}),
      ...(config.effort ? { output_config: { effort: config.effort } } : {}),
      cache_control: { type: 'ephemeral' },
      system: request.system,
      tools: request.tools,
      tool_choice: { type: 'auto' },
      messages: request.messages,
    });
  };
}

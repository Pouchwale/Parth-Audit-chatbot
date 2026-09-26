import Groq from 'groq-sdk';
import type { Config } from '../config.ts';

export type Message = Groq.Chat.ChatCompletionMessageParam;
export type ToolMessage = Groq.Chat.ChatCompletionToolMessageParam;
export type Tool = Groq.Chat.ChatCompletionTool;

export interface ModelRequest {
  system: string;
  tools: Tool[];
  messages: Message[];
}

/** One call to the model. Tests swap in a scripted fake. */
export type Model = (request: ModelRequest) => Promise<Groq.Chat.ChatCompletion>;

/** Thrown when no Groq API key is configured. */
export class ModelNotConfigured extends Error {}

export function groqModel(config: Config): Model {
  // Created on first use, so the server can start (and people can sign in) before a key is configured.
  let client: Groq | undefined;
  return async (request) => {
    if (!config.groqApiKey) throw new ModelNotConfigured('GROQ_API_KEY is not set');
    client ??= new Groq({ apiKey: config.groqApiKey, timeout: 60_000 });
    const params = {
      model: config.model,
      messages: [{ role: 'system' as const, content: request.system }, ...request.messages],
      tools: request.tools,
      tool_choice: 'auto' as const,
      // Groq recommends a low temperature for reliable tool calls.
      temperature: 0.3,
      max_completion_tokens: 8192,
      ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
    };
    try {
      return await client.chat.completions.create(params);
    } catch (error) {
      // Groq rejects a response whose tool call it can't parse; a second, colder try usually works.
      if (!isFailedToolCall(error)) throw error;
      return client.chat.completions.create({ ...params, temperature: 0 });
    }
  };
}

export function isFailedToolCall(error: unknown): boolean {
  if (!(error instanceof Groq.BadRequestError)) return false;
  const body = error.error as { code?: string; error?: { code?: string } } | undefined;
  return (body?.error?.code ?? body?.code) === 'tool_use_failed';
}

import { z } from 'zod';
import { isTimeZone } from './time.ts';

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().optional(),
  CREDENTIALS_KEY: z.string({ error: 'CREDENTIALS_KEY is required (see server/.env.example)' }),
  SUPER_ADMINS: z.string().default(''),
  SESSION_TTL_DAYS: z.coerce.number().positive().default(30),
  CONFIRMATION_TTL_MINUTES: z.coerce.number().positive().default(10),
  CONVERSATION_RETENTION_DAYS: z.coerce.number().positive().default(30),
  REPORT_TIME_ZONE: z.string().default('UTC').refine(isTimeZone, 'REPORT_TIME_ZONE must be an IANA time zone, such as Europe/London'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
  GROQ_REASONING_EFFORT: z.enum(['', 'low', 'medium', 'high']).default('medium'),
  GROQ_FALLBACK_MODEL: z.string().optional(),
  GROQ_TITLE_MODEL: z.string().default('openai/gpt-oss-20b'),
  // Not the turbo: people speak Gujarati and Hindi as well as English (see server/.env.example).
  GROQ_TRANSCRIPTION_MODEL: z.string().default('whisper-large-v3'),
  GROQ_VISION_MODEL: z.string().default('qwen/qwen3.8-27b'),
  FILE_MAX_MB: z.coerce.number().positive().default(20),
  FILE_TEXT_CHARS: z.coerce.number().int().positive().default(16_000),
  HISTORY_CHARS: z.coerce.number().int().positive().default(12_000),
  DCRS_BASE_URL: z.url().optional(),
  TRUST_PROXY: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:8081,http://127.0.0.1:8081'),
});

export interface Config {
  port: number;
  host: string;
  /** Postgres URL. Anything else (or nothing) runs the embedded PGlite database at that path. */
  databaseUrl: string;
  /** AES-256 key for connector credentials stored at rest. */
  credentialsKey: Buffer;
  /** Lower-cased usernames that get the super admin view. */
  superAdmins: ReadonlySet<string>;
  sessionTtlMs: number;
  confirmationTtlMs: number;
  conversationRetentionMs: number;
  /** IANA time zone whose Monday-to-Sunday weeks the weekly reports cover. */
  reportTimeZone: string;
  /** Missing means the assistant can't answer yet; sign-in and the admin view still work. */
  groqApiKey: string | undefined;
  model: string;
  /** For reasoning models such as gpt-oss. Empty sends nothing. */
  reasoningEffort: '' | 'low' | 'medium' | 'high';
  /**
   * Answers instead of `model` while Groq's limits keep that one busy for more than a moment. Each model has limits
   * of its own. It is sent the same reasoning effort. Undefined: the wait is waited, and the person told.
   */
  fallbackModel: string | undefined;
  /** Names new conversations. */
  titleModel: string;
  /** Turns voice recordings into text, in whichever of English, Gujarati and Hindi was spoken. */
  transcriptionModel: string;
  /** Reads the photos people attach. It must accept images; the chat models don't. */
  visionModel: string;
  /** The largest file a person can attach. */
  fileMaxBytes: number;
  /**
   * How much of the attached files' text the model is given in one request, in characters across the whole
   * conversation. About four characters make a token, and the request must fit the key's tokens-per-minute limit.
   */
  fileTextChars: number;
  /**
   * How much of a conversation's earlier turns the model is given with each request, in characters. Older turns are
   * left out first, whole. The turn being answered is always given in full.
   */
  historyChars: number;
  dcrsBaseUrl: string | undefined;
  trustProxy: boolean | string[] | ((address: string, hop: number) => boolean);
  corsOrigins: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const blankToUndefined = Object.fromEntries(
    Object.entries(env).map(([k, v]) => [k, v === '' && k !== 'GROQ_REASONING_EFFORT' ? undefined : v]),
  );
  const parsed = Env.safeParse(blankToUndefined);
  if (!parsed.success) throw new Error(`Invalid server configuration:\n${z.prettifyError(parsed.error)}`);
  const e = parsed.data;

  const credentialsKey = Buffer.from(e.CREDENTIALS_KEY, 'base64');
  if (credentialsKey.length !== 32) throw new Error('CREDENTIALS_KEY must be 32 random bytes, base64-encoded');

  return {
    port: e.PORT,
    host: e.HOST,
    databaseUrl: e.DATABASE_URL ?? '.data/pglite',
    credentialsKey,
    superAdmins: new Set(list(e.SUPER_ADMINS).map((u) => u.toLowerCase())),
    sessionTtlMs: e.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    confirmationTtlMs: e.CONFIRMATION_TTL_MINUTES * 60 * 1000,
    conversationRetentionMs: e.CONVERSATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    reportTimeZone: e.REPORT_TIME_ZONE,
    groqApiKey: e.GROQ_API_KEY,
    model: e.GROQ_MODEL,
    reasoningEffort: e.GROQ_REASONING_EFFORT,
    fallbackModel: e.GROQ_FALLBACK_MODEL,
    titleModel: e.GROQ_TITLE_MODEL,
    transcriptionModel: e.GROQ_TRANSCRIPTION_MODEL,
    visionModel: e.GROQ_VISION_MODEL,
    fileMaxBytes: Math.floor(e.FILE_MAX_MB * 1024 * 1024),
    fileTextChars: e.FILE_TEXT_CHARS,
    historyChars: e.HISTORY_CHARS,
    dcrsBaseUrl: e.DCRS_BASE_URL,
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
    corsOrigins: list(e.CORS_ORIGINS),
  };
}

function list(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

// Fastify's trustProxy: true (any proxy), a hop count, or the proxy addresses to trust.
function parseTrustProxy(value: string | undefined): Config['trustProxy'] {
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return (_address, hop) => hop < hops;
  }
  return list(value);
}

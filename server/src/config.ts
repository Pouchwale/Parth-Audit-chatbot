import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().optional(),
  CREDENTIALS_KEY: z.string({ error: 'CREDENTIALS_KEY is required (see server/.env.example)' }),
  SUPER_ADMINS: z.string().default(''),
  SESSION_TTL_DAYS: z.coerce.number().positive().default(30),
  CONFIRMATION_TTL_MINUTES: z.coerce.number().positive().default(10),
  CONVERSATION_RETENTION_HOURS: z.coerce.number().positive().default(24),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  ANTHROPIC_EFFORT: z.enum(['', 'low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  ANTHROPIC_FALLBACKS: z.enum(['', 'default']).default('default'),
  DCRS_BASE_URL: z.url().optional(),
  TRUST_PROXY: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:8081'),
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
  model: string;
  effort: '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  fallbacks: '' | 'default';
  dcrsBaseUrl: string | undefined;
  trustProxy: boolean | string[] | ((address: string, hop: number) => boolean);
  corsOrigins: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const blankToUndefined = Object.fromEntries(
    Object.entries(env).map(([k, v]) => [k, v === '' && k !== 'ANTHROPIC_EFFORT' && k !== 'ANTHROPIC_FALLBACKS' ? undefined : v]),
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
    conversationRetentionMs: e.CONVERSATION_RETENTION_HOURS * 60 * 60 * 1000,
    model: e.ANTHROPIC_MODEL,
    effort: e.ANTHROPIC_EFFORT,
    fallbacks: e.ANTHROPIC_FALLBACKS,
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

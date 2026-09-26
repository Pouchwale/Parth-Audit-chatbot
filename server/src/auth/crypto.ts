import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only the hash of a session token is stored, so a database leak doesn't leak working tokens. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Encrypts a JSON value with AES-256-GCM: "iv.tag.ciphertext", each base64url. */
export function seal(key: Buffer, value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
}

export function unseal(key: Buffer, sealed: string): unknown {
  const [iv, tag, data] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !data) throw new Error('Malformed sealed value');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}

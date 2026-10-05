/**
 * AES-256-GCM encryption for secrets kept in the persisted state (UI-entered credentials,
 * connected X account tokens, pending OAuth request tokens). Keyed by CREDENTIALS_ENCRYPTION_KEY.
 */

import crypto from 'crypto';

const BLOB_PREFIX = 'enc:v1:';

/** AES-256-GCM key from `CREDENTIALS_ENCRYPTION_KEY` (32 bytes as 64 hex chars or base64), or null. */
export const getEncryptionKey = (): Buffer | null => {
  const raw = (process.env.CREDENTIALS_ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    console.error('[Credentials] CREDENTIALS_ENCRYPTION_KEY must be 32 bytes (hex or base64).');
    return null;
  }
  return key;
};

export const encrypt = (plain: string, key: Buffer): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${BLOB_PREFIX}${[iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64')).join(':')}`;
};

/** Throws on a wrong key or a tampered blob. */
export const decrypt = (blob: string, key: Buffer): string => {
  const [iv, tag, ct] = blob
    .slice(BLOB_PREFIX.length)
    .split(':')
    .map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
};

/** JSON round-trip helpers; `decryptJson` returns null when the key is missing or wrong. */
export const encryptJson = (value: unknown, key: Buffer): string =>
  encrypt(JSON.stringify(value), key);

export const decryptJson = <T>(blob: string | undefined): T | null => {
  const key = getEncryptionKey();
  if (!blob || !key) return null;
  try {
    return JSON.parse(decrypt(blob, key)) as T;
  } catch {
    return null;
  }
};

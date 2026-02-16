import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) return null;
  // Accept hex key (64 chars = 32 bytes) or raw 32-byte string
  if (key.length === 64) return Buffer.from(key, 'hex');
  if (key.length === 32) return Buffer.from(key, 'utf8');
  return null;
}

export function encrypt(text) {
  const key = getKey();
  if (!key) return text; // Graceful fallback if no key configured
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  // Format: iv:tag:encrypted (all hex)
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

export function decrypt(text) {
  if (!text || !text.startsWith('enc:')) return text; // Not encrypted
  const key = getKey();
  if (!key) return text;
  const parts = text.split(':');
  if (parts.length !== 4) return text;
  const iv = Buffer.from(parts[1], 'hex');
  const tag = Buffer.from(parts[2], 'hex');
  const encrypted = parts[3];
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

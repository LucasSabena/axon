import { createHmac, randomBytes } from 'crypto';

// ---------- TOTP (RFC 6238) ----------
// Dependency-free: 160-bit base32 secret + HMAC-SHA1, 30s steps, 6 digits.
// The secret lives in config.auth.totpSecret (base32). Enrollment uses an
// in-memory pending secret that must be confirmed with a valid code.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS = 30_000;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, timeMs = Date.now()): string {
  const key = base32Decode(secret);
  const counter = Math.floor(timeMs / STEP_MS);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const code =
    (((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]) %
    10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

// Accepts the previous/next 30s step for clock drift.
export function verifyTotp(secret: string, code: string, window = 1): boolean {
  const clean = (code || '').replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(clean)) return false;
  const now = Date.now();
  for (let w = -window; w <= window; w++) {
    if (totpCode(secret, now + w * STEP_MS) === clean) return true;
  }
  return false;
}

export function totpUri(secret: string, username: string, issuer = 'AXON'): string {
  return (
    `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}` +
    `?secret=${secret}&issuer=${encodeURIComponent(issuer)}`
  );
}

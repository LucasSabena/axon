import { createHash, createHmac, randomBytes } from 'crypto';

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

// ---------- Recovery codes ----------
// Single-use backups for when the authenticator is unavailable — without them,
// losing the device means irreversible lockout (la cuenta es local, sin mail).
//
// Plaintext codes are shown ONCE at enable time; only SHA-256 hashes persist
// (en config.auth.totpRecovery: string[] — requiere agregar el campo opcional
// a AppConfig.auth en types.ts y llamar estas funciones desde index.ts:
//   enable: config.auth.totpRecovery = generateRecoveryCodes().map(hashRecoveryCode)
//           y devolver los códigos en claro en la respuesta para mostrarlos una vez
//   login:  valid = verifyTotp(...) || consumeRecoveryCode(config.auth.totpRecovery, code)
//   disable: delete config.auth.totpRecovery
// ).

// 'xxxx-xxxx' — 40 bits, alfabeto base32 sin ambigüedades, fácil de tipear.
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = base32Encode(randomBytes(5)).toLowerCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return codes;
}

const normalizeRecovery = (code: string): string =>
  (code || '').toUpperCase().replace(/[^A-Z2-7]/g, '');

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecovery(code)).digest('hex');
}

// Returns true and removes the hash on match — the caller must saveConfig().
export function consumeRecoveryCode(hashes: string[] | undefined, code: string): boolean {
  if (!Array.isArray(hashes)) return false;
  const index = hashes.indexOf(hashRecoveryCode(code));
  if (index === -1) return false;
  hashes.splice(index, 1);
  return true;
}

import { createHash, randomBytes } from 'node:crypto';
import type { AppConfig } from './types';

type Auth = AppConfig['auth'];
interface Challenge { username: string; fingerprint: string; source: string; expires: number; failures: number }
const fingerprint = (auth: Auth) => createHash('sha256').update(JSON.stringify([auth.username, auth.passwordHash, auth.totpSecret])).digest('hex');

// Proof of the password step, never an administrator session. Kept only for a
// few minutes and invalidated when credentials or the second factor change.
export class LoginChallenges {
  private entries = new Map<string, Challenge>();
  constructor(private now = Date.now, private ttlMs = 300000, private limit = 2000) {}
  issue(auth: Auth, source: string): string {
    for (const [id, item] of this.entries) if (item.expires <= this.now()) this.entries.delete(id);
    if (this.entries.size >= this.limit) this.entries.delete(this.entries.keys().next().value!);
    const id = randomBytes(32).toString('hex');
    this.entries.set(id, { username: auth.username, fingerprint: fingerprint(auth), source, expires: this.now()+this.ttlMs, failures:0 });
    return id;
  }
  get(id: unknown, auth: Auth, source: string): string | null {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return null;
    const item = this.entries.get(id);
    if (!item) return null;
    if (item.expires <= this.now() || item.fingerprint !== fingerprint(auth)) { this.entries.delete(id); return null; }
    if (item.source !== source) return null;
    return item.username;
  }
  fail(id: string): void {
    const item = this.entries.get(id);
    if (item && ++item.failures >= 5) this.entries.delete(id);
  }
  consume(id: string): void { this.entries.delete(id); }
}

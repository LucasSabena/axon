import { watch, type FSWatcher, type Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as path from 'node:path';

// ctime catches exporters that preserve mtime and replace equally sized files.
// Keep sub-millisecond precision; path IDs remain stable across replacements.
export function libraryFileVersion(st: Stats): string {
  return createHash('sha1').update(`${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`).digest('hex').slice(0, 20);
}

// Watch directories rather than file inodes: atomic saves replace the inode.
// Bound watches and queued paths; the periodic scan covers unavailable
// watches, overflow, and changes while the service was stopped.
export class LibraryLiveWatch {
  private watches = new Map<string, { watcher: FSWatcher; identity: string }>();
  private dirty = new Set<string>();
  private overflow = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private closed = false;

  constructor(private toContainer: (p: string) => string,
    private changed: (paths: string[] | null) => Promise<void>,
    private delay = 500, private limit = 8192) {}

  async sync(directories: Set<string>): Promise<void> {
    if (this.closed) return;
    const desired = new Set([...directories].slice(0, this.limit));
    for (const [dir, entry] of this.watches) if (!desired.has(dir)) {
      entry.watcher.close(); this.watches.delete(dir);
    }
    for (const dir of desired) {
      const st = await stat(this.toContainer(dir)).catch(() => null);
      const identity = st?.isDirectory() ? `${st.dev}:${st.ino}` : '';
      const previous = this.watches.get(dir);
      if (previous && previous.identity === identity) continue;
      previous?.watcher.close(); this.watches.delete(dir);
      if (!identity || this.closed) continue;
      try {
        const watcher = watch(this.toContainer(dir), { persistent: false }, (_event, name) => {
          this.queue(name ? path.posix.join(dir, String(name)) : dir);
        });
        watcher.on('error', () => {
          watcher.close(); this.watches.delete(dir); this.queue(dir);
        });
        this.watches.set(dir, { watcher, identity });
      } catch { /* periodic reconciliation remains available */ }
    }
  }

  private queue(p: string): void {
    if (this.closed) return;
    if (!this.dirty.has(p)) {
      if (this.dirty.size < this.limit) this.dirty.add(p);
      else this.overflow = true;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.delay);
    this.timer.unref();
  }

  private async flush(): Promise<void> {
    if (this.running || this.closed) return;
    this.running = true;
    const batch = this.overflow ? null : [...this.dirty];
    this.dirty.clear(); this.overflow = false;
    try { await this.changed(batch); }
    catch (error) { console.error('library live refresh', error); }
    finally {
      this.running = false;
      if (!this.closed && (this.dirty.size || this.overflow) && !this.timer) {
        this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.delay);
        this.timer.unref();
      }
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const { watcher } of this.watches.values()) watcher.close();
    this.watches.clear(); this.dirty.clear();
  }
}

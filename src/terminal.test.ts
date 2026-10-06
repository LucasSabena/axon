import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { hostTerminalCommand } from './terminal';

test('PTY waits for delayed Bash startup, sources config once, and preserves the tmux session after disconnect', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'axon-term-test-'));
  const socket = 'axon-test-' + crypto.randomUUID();
  let proc: ReturnType<typeof Bun.spawn> | undefined;
  try {
    await writeFile(path.join(home, '.bashrc'), 'sleep .15\nprintf "fixture-startup\\n"\nPS1="fixture$ "\n');
    proc = Bun.spawn(['bash', '-c', hostTerminalCommand({ session: 'fixture', cols: 120, rows: 20, socket })], { env: { ...process.env, HOME: home, SHELL: '/bin/bash' }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder(); let output = '', sent = false;
    const timeout = setTimeout(() => proc?.kill(), 8000);
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        output += decoder.decode(value, { stream: true });
        if (!sent && output.includes('\x1b]777;axon-ready\x07')) {
          sent = true;
          (proc.stdin as Bun.FileSink).write("printf '\\nAXON_TEST_EXECUTED\\n'\n");
          (proc.stdin as Bun.FileSink).flush();
        }
        if (/(?:\r\n|\x1b\[[\d;]*H)AXON_TEST_EXECUTED(?:\r\n|\x1b\[K)/.test(output)) break;
      }
      expect(sent, output).toBe(true);
      // tmux may redraw the same screen in the raw stream; count visible
      // command/output lines in the pane rather than escape-code redraws.
      const screen = Bun.spawn(['tmux', '-L', socket, 'capture-pane', '-p', '-t', 'fixture'], {stdout:'pipe',stderr:'ignore'});
      const visible = await new Response(screen.stdout).text(); await screen.exited;
      expect(visible.split('\n').filter(line => line.includes("printf '\\nAXON_TEST_EXECUTED")).length, visible).toBe(1);
      expect(visible.split('\n').filter(line => line.trim() === 'AXON_TEST_EXECUTED').length, visible).toBe(1);
      // Disconnect the bridge; the pane and its shell remain resumable.
      const detach = Bun.spawn(['tmux', '-L', socket, 'detach-client', '-s', 'fixture'], { stdout: 'ignore', stderr: 'ignore' }); await detach.exited;
      expect(await proc.exited).toBe(0);
      const exists = Bun.spawn(['tmux', '-L', socket, 'has-session', '-t', 'fixture'], { stdout: 'ignore', stderr: 'ignore' }); expect(await exists.exited).toBe(0);
      const captured = Bun.spawn(['tmux', '-L', socket, 'capture-pane', '-p', '-t', 'fixture'], {stdout:'pipe',stderr:'ignore'});
      const pane = await new Response(captured.stdout).text(); await captured.exited;
      expect(pane.match(/fixture-startup/g)?.length).toBe(1);
    } finally { clearTimeout(timeout); }
  } finally {
    proc?.kill();
    const cleanup = Bun.spawn(['tmux', '-L', socket, 'kill-server'], { stdout: 'ignore', stderr: 'ignore' }); await cleanup.exited;
    await rm(home, { recursive: true, force: true });
  }
}, 12_000);

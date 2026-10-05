const quote = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;

/** The Bash rc sentinel is removed only after config loads.
 * The outer bridge emits readiness directly, since tmux filters unknown OSCs.
 * socket is used only by isolated PTY regression tests. */
export function hostTerminalCommand(opts: { session: string; cols: number; rows: number; exec?: string; socket?: string }) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(opts.session) || (opts.socket && !/^[a-zA-Z0-9_-]{1,80}$/.test(opts.socket))) throw new Error('Invalid terminal session');
  const cols = Number.isFinite(opts.cols) ? Math.max(2, Math.min(500, Math.floor(opts.cols))) : 120;
  const rows = Number.isFinite(opts.rows) ? Math.max(2, Math.min(200, Math.floor(opts.rows))) : 40;
  const script = 'SHELL=/bin/sh script --quiet --flush --echo never --command';
  if (opts.exec) {
    const inner = `stty -echo cols ${cols} rows ${rows}; exec docker exec -it -e COLUMNS=${cols} -e LINES=${rows} ${quote(opts.exec)} sh -c 'command -v bash >/dev/null && exec bash -l || exec sh -l'`;
    return `export TERM=xterm-256color; ${script} ${quote(inner)} /dev/null`;
  }
  const tmux = 'tmux' + (opts.socket ? ' -L ' + quote(opts.socket) + ' -f /dev/null' : '');
  const session = quote(opts.session);
  const rc = ['. "$HOME/.bashrc"', 'command rm -f -- "${BASH_SOURCE[0]}"'].join('\n') + '\n';
  const inner = `stty -echo cols ${cols} rows ${rows}; exec ${tmux} new-session -A -s ${session} bash --rcfile "$axon_term_rc" -i`;
  // Escape only the outer shell's quotes. $axon_term_rc expands to our mktemp
  // path; every user value is already quoted within the script command.
  const innerArg = '"' + inner.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('`', '\\`') + '"';
  // Readline disables kernel echo when it is ready to accept input. Waiting
  // for that state avoids submitting typeahead that appears twice in tmux.
  const ready = `axon_term_tty=$(${tmux} display-message -p -t ${session} '#{pane_tty}' 2>/dev/null); axon_term_attempt=0; while [ "$axon_term_existing" = 0 ] && [ "$axon_term_attempt" -lt 100 ] && kill -0 "$axon_term_child" 2>/dev/null; do axon_term_modes=$(stty -F "$axon_term_tty" -a 2>/dev/null); case " $axon_term_modes " in *" -echo "*) break;; esac; axon_term_attempt=$((axon_term_attempt + 1)); sleep 0.02; done`;
  return `axon_term_rc=$(mktemp /tmp/axon-term-rc.XXXXXX) || exit 1; trap 'command rm -f -- "$axon_term_rc"' EXIT; printf '%s' ${quote(rc)} > "$axon_term_rc"; export TERM=xterm-256color; axon_term_existing=0; ${tmux} has-session -t ${session} 2>/dev/null && axon_term_existing=1; ${script} ${innerArg} /dev/null <&0 & axon_term_child=$!; while [ "$axon_term_existing" = 0 ] && [ -e "$axon_term_rc" ] && kill -0 "$axon_term_child" 2>/dev/null; do sleep 0.02; done; ${ready}; if kill -0 "$axon_term_child" 2>/dev/null; then printf '\\033]777;axon-ready\\007'; fi; wait "$axon_term_child"`;
}

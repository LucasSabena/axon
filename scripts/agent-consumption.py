"""Incremental metadata-only usage index. Native histories are never written.

Token categories are disjoint except reasoning, a documented subset of output.
No prompts, response text, credentials or native recorded cost become an invoice.
"""
import os, sys, json, math, re, time, sqlite3, hashlib, fcntl, tempfile, urllib.request
from pathlib import Path
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, TZPATH

FIELDS = ('input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'cacheWrite1h')
AGENTS = ('codex', 'claude', 'opencode', 'gemini', 'devin')
CATALOG_URL = 'https://models.dev/api.json'

def number(v):
    if isinstance(v, bool): return 0
    try:
        n = float(v)
        return int(n) if math.isfinite(n) and 0 <= n <= 10**15 else 0
    except (ValueError, TypeError, OverflowError): return 0

def stamp(v):
    try:
        if isinstance(v, (int, float)): return float(v) / (1000 if v > 10**11 else 1)
        parsed = datetime.fromisoformat(str(v).replace('Z', '+00:00'))
        return (parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)).timestamp()
    except (ValueError, TypeError): return 0

def digest(v): return hashlib.sha256(v.encode()).hexdigest()
def text(v): return str(v or '')[:240]
def obj(v): return v if isinstance(v, dict) else {}

def local_zone(name):
    try: return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        # Browsers use ICU's older canonical names, while current tzdata may
        # install canonical zones without their backward symlinks. Resolve
        # official IANA links instead of silently falling back to host time.
        links = {}
        for root in TZPATH:
            try:
                for line in (Path(root) / 'tzdata.zi').read_text().splitlines():
                    fields = line.split()
                    if len(fields) == 3 and fields[0] in ('L', 'Link'): links[fields[2]] = fields[1]
            except OSError: continue
        target = name
        for _ in range(8):
            if target not in links: break
            target = links[target]
            try: return ZoneInfo(target)
            except ZoneInfoNotFoundError: continue
        raise ValueError('Zona horaria no disponible')

def tokens(u, agent):
    u = obj(u)
    if agent == 'codex':
        original_input = number(u.get('input_tokens'))
        read = min(original_input, number(u.get('cached_input_tokens')))
        write = min(original_input - read, number(u.get('cache_write_input_tokens', u.get('cache_creation_input_tokens'))))
        return dict(input=max(0, number(u.get('input_tokens')) - read - write), output=number(u.get('output_tokens')),
                    cacheRead=read, cacheWrite=write, reasoning=number(u.get('reasoning_output_tokens')), cacheWrite1h=0)
    if agent == 'claude':
        write = number(u.get('cache_creation_input_tokens')); hourly = min(write, number(obj(u.get('cache_creation')).get('ephemeral_1h_input_tokens')))
        return dict(input=number(u.get('input_tokens')), output=number(u.get('output_tokens')), cacheRead=number(u.get('cache_read_input_tokens')),
                    cacheWrite=write, reasoning=number(obj(u.get('output_tokens_details')).get('thinking_tokens')), cacheWrite1h=hourly)
    if agent == 'opencode':
        cache = obj(u.get('cache')); reasoning = number(u.get('reasoning'))
        # Native OpenCode output excludes the separately stored reasoning.
        return dict(input=number(u.get('input')), output=number(u.get('output')) + reasoning, cacheRead=number(cache.get('read')),
                    cacheWrite=number(cache.get('write')), reasoning=reasoning, cacheWrite1h=0)
    read = number(u.get('cached', u.get('cachedContentTokenCount')))
    return dict(input=max(0, number(u.get('input', u.get('promptTokenCount'))) - read),
                output=number(u.get('output', u.get('candidatesTokenCount'))) + number(u.get('thoughts', u.get('thoughtsTokenCount'))),
                cacheRead=read, cacheWrite=0, reasoning=number(u.get('thoughts', u.get('thoughtsTokenCount'))), cacheWrite1h=0)

def total(t): return sum(t.get(k, 0) for k in ('input', 'output', 'cacheRead', 'cacheWrite'))

def event(key, agent, session, at, model, provider, usage, account='unknown', basis='unknown', project=''):
    t = tokens(usage, agent)
    if not total(t) or not stamp(at): return None
    return dict(id=digest(agent + ':' + key), agent=agent, session=text(session), at=stamp(at), model=text(model) or 'unknown',
                provider=text(provider) or 'unknown', account=text(account) or 'unknown', accountBasis=basis,
                project=os.path.normpath(project) if isinstance(project, str) and project.startswith('/') and len(project) <= 4096 else '', **t)

def parse_codex(o, state):
    p = obj(o.get('payload')); kind = o.get('type')
    if kind == 'session_meta':
        state.update(session=text(p.get('id')), provider=text(p.get('model_provider')) or 'openai', account=text(p.get('creator_account_id')) or state.get('account', 'unknown'))
        state['project'] = p.get('cwd') or ''
        if p.get('creator_account_id'): state['basis'] = 'creator'
    if kind == 'turn_context':
        state['model'] = text(p.get('model')) or state.get('model', 'unknown')
        if p.get('cwd'): state['project'] = p['cwd']
        # Only explicit per-turn identity overrides creator identity.
        if p.get('account_id'): state.update(account=text(p['account_id']), basis='request')
    if kind != 'event_msg' or p.get('type') != 'token_count': return []
    info = obj(p.get('info')); cumulative = obj(info.get('total_token_usage')); previous = state.get('previous')
    if cumulative and cumulative == previous: return []
    last = obj(info.get('last_token_usage'))
    if not last and cumulative: last = {k: max(0, number(v) - number(obj(previous).get(k))) for k, v in cumulative.items()}
    if cumulative: state['previous'] = cumulative
    # Key includes original timestamp, preserving dedupe across copied rollouts.
    e = event(state['session'] + ':' + str(o.get('timestamp')) + ':' + digest(json.dumps(cumulative or last, sort_keys=True)), 'codex', state['session'], o.get('timestamp'),
              p.get('model') or info.get('model') or state.get('model'), state.get('provider', 'openai'), last, state.get('account', 'unknown'), state.get('basis', 'unknown'), state.get('project', ''))
    return [e] if e else []

def parse_claude(o, state):
    if o.get('cwd'): state['project'] = o['cwd']
    m = obj(o.get('message')); usage = obj(m.get('usage'))
    if o.get('type') != 'assistant' or not usage: return []
    session = text(o.get('sessionId')) or state['session']
    key = ':'.join([text(o.get('requestId')), text(m.get('id'))])
    if key == ':': key = session + ':' + text(o.get('uuid') or o.get('timestamp'))
    e = event(key, 'claude', session, o.get('timestamp'), m.get('model'), 'anthropic', usage, state.get('account', 'unknown'), state.get('basis', 'unknown'), state.get('project', ''))
    return [e] if e else []

def parse_gemini(o, state):
    if o.get('cwd') or o.get('projectPath'): state['project'] = o.get('cwd') or o['projectPath']
    if o.get('sessionId'): state['session'] = text(o['sessionId'])
    messages = o.get('messages') or obj(o.get('$set')).get('messages') or ([o] if o.get('type') in ('gemini', 'assistant') else [])
    out = []
    for m in messages:
        if not isinstance(m, dict) or m.get('type') not in ('gemini', 'assistant'): continue
        e = event(state['session'] + ':' + text(m.get('id') or m.get('timestamp')), 'gemini', state['session'], m.get('timestamp'), m.get('model'), 'google', m.get('tokens') or m.get('usageMetadata'), project=state.get('project', ''))
        if e: out.append(e)
    return out

def private_dir(p):
    if p.is_symlink(): raise ValueError('Estado privado no válido')
    p.mkdir(parents=True, exist_ok=True, mode=0o700); os.chmod(p, 0o700)

def atomic_json(p, d):
    if p.is_symlink(): raise ValueError('Archivo privado no válido')
    fd, name = tempfile.mkstemp(dir=p.parent)
    try:
        with os.fdopen(fd, 'w') as f: json.dump(d, f, separators=(',', ':'))
        os.chmod(name, 0o600); os.replace(name, p)
    finally:
        if os.path.exists(name): os.unlink(name)

def read_json(p):
    try:
        if p.is_symlink(): return {}
        return json.loads(p.read_text())
    except (OSError, ValueError): return {}

class Catalog:
    def __init__(self, folder, now=None, fetch=None):
        self.folder = folder; self.now = now or time.time(); self.fetch = fetch or self.download
        self.data = {}; self.meta = {}; self.resolved = {}

    @staticmethod
    def download():
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *_): raise ValueError('Redirección de catálogo no permitida')
        request = urllib.request.Request(CATALOG_URL, headers={'User-Agent': 'axon-consumption/1.0', 'Accept': 'application/json'})
        with urllib.request.build_opener(NoRedirect).open(request, timeout=8) as response:
            raw = response.read(20_000_001)
        if len(raw) > 20_000_000: raise ValueError('Catálogo demasiado grande')
        return json.loads(raw)

    def load(self, force=False):
        path = self.folder / 'prices.json'; cached = read_json(path); fetched = cached.get('fetchedAt', 0); checked = cached.get('checkedAt', 0)
        if (force or self.now - fetched > 86400) and self.now - checked >= 60:
            lock = os.open(self.folder / 'prices.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            try:
                try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    self.data = obj(cached.get('models')); self.meta = dict(source='models.dev', url='https://models.dev', fetchedAt=cached.get('fetchedAt'),
                        stale=bool(cached.get('failed')) or self.now - cached.get('fetchedAt', 0) > 86400, modelCount=len(self.data), automaticHours=24)
                    return self
                raw = self.fetch(); clean = {}
                if not isinstance(raw, dict) or len(raw) > 2000: raise ValueError('Catálogo inválido')
                for provider, p in raw.items():
                    if not isinstance(p, dict): continue
                    for model, m in obj(p.get('models')).items():
                        if not isinstance(m, dict) or not isinstance(m.get('cost'), dict): continue
                        # Keep only pricing metadata; never code, URLs or env names.
                        cost = m['cost']; clean[provider + '/' + model] = {'cost': cost, 'canonical': m.get('canonical_model_id'), 'name': text(m.get('name'))}
                if not clean: raise ValueError('Catálogo sin precios')
                cached = {'fetchedAt': self.now, 'checkedAt': self.now, 'models': clean, 'failed': False}; atomic_json(path, cached)
            except Exception:
                cached.update(checkedAt=self.now, failed=True); atomic_json(path, cached)
            finally: os.close(lock)
        self.data = obj(cached.get('models')); self.meta = dict(source='models.dev', url='https://models.dev', fetchedAt=cached.get('fetchedAt'),
            stale=bool(cached.get('failed')) or self.now - cached.get('fetchedAt', 0) > 86400, modelCount=len(self.data), automaticHours=24)
        return self

    def lookup(self, provider, model):
        key = (provider, model)
        if key not in self.resolved: self.resolved[key] = self.resolve(provider, model)
        return self.resolved[key]

    def resolve(self, provider, model):
        # Never use fuzzy model names or a random provider's price.
        subscriptions = ('opencode-go', 'github-copilot', 'ollama-cloud', 'minimax-coding-plan')
        providers = [provider]
        if provider in ('openai', 'codex', 'chatgpt'): providers = ['openai']
        if provider == 'anthropic': providers = ['anthropic']
        if provider == 'google': providers = ['google']
        if provider == 'minimax-coding-plan': providers = ['minimax', 'minimax-cn']
        models = [model]
        dated = re.sub(r'-\d{8}$', '', model)
        if dated != model: models.append(dated)
        for p in providers:
            for m in models:
                hit = self.data.get(p + '/' + m)
                if hit and provider not in subscriptions: return hit, p + '/' + m, 'provider' if p == provider else 'api-equivalent'
                if hit and p != provider: return hit, p + '/' + m, 'api-equivalent'
        # Subscription/relay models may point to a canonical lab ID in the catalog.
        hits = [(k, v) for k, v in self.data.items() if k.startswith(provider + '/') and k.split('/', 1)[1] in models]
        for k, v in hits:
            if v.get('canonical') in self.data: return self.data[v['canonical']], v['canonical'], 'api-equivalent'
        for k, v in hits:
            # Some subscription routes publish token comparison prices even
            # when the lab does not publish that model's API endpoint. Keep
            # that explicit provider rate; do not mistake Copilot's zero
            # subscription price for free public inference.
            cost = obj(v.get('cost'))
            positive = any(isinstance(cost.get(k), (int, float)) and not isinstance(cost[k], bool) and math.isfinite(cost[k]) and cost[k] > 0 for k in ('input', 'output'))
            if provider != 'github-copilot' and (positive or '-free' in model): return v, k, 'provider'
        # A subscription has no per-token invoice. Use exact native lab model ID,
        # and tell the UI which public API is the comparison basis.
        if provider in subscriptions + ('opencode',):
            candidates = [(k, v) for k, v in self.data.items() if k.split('/', 1)[0] in ('openai', 'anthropic', 'google', 'minimax', 'moonshotai', 'zai', 'deepseek', 'xai') and k.split('/', 1)[1] in models]
            if len(candidates) == 1: return candidates[0][1], candidates[0][0], 'api-equivalent'
        # Custom relay IDs can still be compared with the public lab API if
        # the catalog unanimously identifies one canonical model. No fuzzy
        # names, no cheapest-provider selection, no substitution of variants.
        canonical = {v['canonical'] for k, v in self.data.items() if k.split('/', 1)[1] in models and v.get('canonical')}
        if len(canonical) == 1:
            key = next(iter(canonical))
            if key in self.data: return self.data[key], key, 'api-equivalent'
        return None, None, None

    def price(self, row):
        hit, key, basis = self.lookup(row['provider'], row['model'])
        if not hit: return dict(status='missing', usd=None, components={}, model=None, basis=None)
        cost = obj(hit.get('cost')); context = row['input'] + row['cacheRead'] + row['cacheWrite']
        tiers = cost.get('tiers') or []
        matching = [t for t in tiers if isinstance(t, dict) and obj(t.get('tier')).get('type') == 'context' and context > number(obj(t.get('tier')).get('size'))]
        if matching: cost = {**cost, **max(matching, key=lambda t: number(obj(t.get('tier')).get('size')))}
        elif not tiers and context > 200000 and isinstance(cost.get('context_over_200k'), dict): cost = {**cost, **cost['context_over_200k']}
        def rate(name):
            value = cost.get(name)
            if isinstance(value, bool): return None
            try:
                n = float(value)
                return n if math.isfinite(n) and 0 <= n < 100000 else None
            except (ValueError, TypeError): return None
        rates = dict(input=rate('input'), output=rate('output'), cacheRead=rate('cache_read'), cacheWrite=rate('cache_write'))
        # Anthropic's 1h creation costs 2x input, versus the catalog's 5m rate.
        hourly = row.get('cacheWrite1h', 0) if key.startswith('anthropic/') else 0
        components = {}; missing = []
        for field, r in rates.items():
            amount = row[field]
            if not amount: components[field] = 0; continue
            if r is None: missing.append(field); continue
            components[field] = amount * r / 1_000_000
        if hourly and rates['input'] is not None and rates['cacheWrite'] is not None:
            components['cacheWrite'] += hourly * (2 * rates['input'] - rates['cacheWrite']) / 1_000_000
        usd = sum(components.values())
        reasoning_rate = rate('reasoning')
        if reasoning_rate is not None and rates['output'] is not None:
            reasoning = min(row['output'], row['reasoning'])
            components['output'] += reasoning * (reasoning_rate - rates['output']) / 1_000_000
            usd = sum(components.values())
            rates['reasoning'] = reasoning_rate
        return dict(status='partial' if missing else 'priced', usd=usd, components=components, model=key, basis=basis, rates=rates, missing=missing)

class Index:
    def __init__(self, home, budget=16):
        self.home = Path(home); self.folder = self.home / '.local/share/axon/agent-consumption'; private_dir(self.folder)
        self.lock = os.open(self.folder / 'index.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        self.busy = False
        try: fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: self.busy = True
        path = self.folder / 'index.sqlite'
        if path.is_symlink(): raise ValueError('Índice no válido')
        self.db = sqlite3.connect(path, timeout=5); self.db.row_factory = sqlite3.Row; os.chmod(path, 0o600)
        self.db.execute('pragma journal_mode=wal')
        self.db.execute('create table if not exists files(path text primary key, signature text, offset integer, state text)')
        self.db.execute('create table if not exists events(id text primary key, agent text, session text, at real, model text, provider text, account text, accountBasis text, input integer, output integer, cacheRead integer, cacheWrite integer, reasoning integer, cacheWrite1h integer)')
        self.db.execute('create index if not exists usage_time on events(agent,at)')
        self.db.execute('create table if not exists meta(key text primary key,value text)'); self.db.commit()
        if 'project' not in {r[1] for r in self.db.execute('pragma table_info(events)')}:
            self.db.execute("alter table events add column project text not null default ''"); self.db.commit()
        if not self.busy and not self.db.execute("select 1 from meta where key='project-attribution-v1'").fetchone():
            # Re-read bounded native metadata. Existing counts remain visible;
            # reinsertions enrich their project without adding duplicate usage.
            self.db.execute('delete from files')
            self.db.execute("delete from meta where key like 'oc:%'")
            self.db.execute("insert into meta values('project-attribution-v1','1')"); self.db.commit()
        self.deadline = time.monotonic() + budget; self.warnings = []; self.pending = 0; self.scanned = 0

    def close(self): self.db.close(); os.close(self.lock)

    def insert(self, e):
        if not e: return
        columns = ('id', 'agent', 'session', 'at', 'model', 'provider', 'account', 'accountBasis') + FIELDS + ('project',)
        # Streaming duplicates replace counts only when a more complete usage
        # snapshot arrives; repeated content blocks do not add another request.
        self.db.execute('insert into events(' + ','.join(columns) + ') values(' + ','.join('?' for _ in columns) + ') on conflict(id) do update set '
            + ','.join(k + '=max(events.' + k + ',excluded.' + k + ')' for k in FIELDS)
            + ",project=case when excluded.project!='' then excluded.project else events.project end", tuple(e.get(k, '') for k in columns))

    def roots(self):
        roots = [('codex', self.home / '.codex/sessions', 'unknown'), ('codex', self.home / '.codex/archived_sessions', 'unknown'),
                 ('claude', self.home / '.claude/projects', 'unknown'), ('gemini', self.home / '.gemini/tmp', 'unknown')]
        base = self.home / '.local/share/axon/agent-accounts'
        for agent, subdirs in [('codex', ['sessions', 'archived_sessions']), ('claude', ['projects'])]:
            folder = base / agent
            if not folder.is_dir() or folder.is_symlink(): continue
            for profile in sorted(folder.iterdir())[:32]:
                if not re.fullmatch(r'(?:current|a-[a-f0-9]{16})', profile.name) or profile.is_symlink(): continue
                for sub in subdirs: roots.append((agent, profile / sub, 'profile:' + profile.name))
        return roots

    def files(self):
        seen = set(); paths = []
        for agent, root, account in self.roots():
            if not root.is_dir() or root.is_symlink(): continue
            for directory, dirs, names in os.walk(root, followlinks=False):
                dirs[:] = [n for n in dirs if n not in ('memory', '.git', 'node_modules') and not Path(directory, n).is_symlink()]
                if len(Path(directory).relative_to(root).parts) > 10: dirs[:] = []
                for name in names:
                    p = Path(directory, name)
                    if p.suffix not in ('.jsonl', '.json') or p.is_symlink() or (agent == 'gemini' and not name.startswith('session-')): continue
                    s = p.stat(); inode = (s.st_dev, s.st_ino)
                    if inode in seen: continue
                    seen.add(inode); paths.append((agent, p, account, s))
        return sorted(paths, key=lambda x: x[3].st_mtime, reverse=True)

    def scan_file(self, agent, p, account, stat):
        path = str(p); previous = self.db.execute('select * from files where path=?', (path,)).fetchone()
        signature = str(stat.st_mtime_ns) + ':' + str(stat.st_size)
        if previous and previous['signature'] == signature: return
        offset = previous['offset'] if previous and previous['offset'] <= stat.st_size else 0
        state = json.loads(previous['state']) if previous and offset else dict(session=p.stem, account=account, basis='profile' if account != 'unknown' else 'unknown')
        parser = {'codex': parse_codex, 'claude': parse_claude, 'gemini': parse_gemini}[agent]
        with p.open('rb') as f:
            if p.suffix == '.json':
                if stat.st_size > 32_000_000: self.warnings.append('Un archivo JSON excede el límite de lectura.'); return
                for e in parser(json.load(f), state): self.insert(e)
                offset = f.tell()
            else:
                f.seek(offset)
                while time.monotonic() < self.deadline:
                    start = f.tell(); line = f.readline(8_000_001)
                    if not line: break
                    if len(line) > 8_000_000:
                        # Consume oversized content records without retaining them.
                        while line and not line.endswith(b'\n'): line = f.readline(8_000_001)
                        offset = f.tell(); continue
                    if not line.endswith(b'\n'): f.seek(start); break
                    offset = f.tell()
                    if agent == 'codex' and not any(k in line[:150] for k in (b'"session_meta"', b'"turn_context"', b'"event_msg"')): continue
                    if agent == 'claude' and b'"usage"' not in line and b'"cwd"' not in line: continue
                    try:
                        o = json.loads(line)
                        if isinstance(o, dict):
                            for e in parser(o, state): self.insert(e)
                    except (ValueError, TypeError): continue
        complete = offset >= stat.st_size
        self.db.execute('insert or replace into files values(?,?,?,?)', (path, signature if complete else '', offset, json.dumps(state)))
        if not complete: self.pending += 1
        self.scanned += 1; self.db.commit()

    def scan_opencode(self):
        p = self.home / '.local/share/opencode/opencode.db'
        if not p.is_file() or p.is_symlink(): return
        db = sqlite3.connect(p.as_uri() + '?mode=ro', uri=True, timeout=1); db.row_factory = sqlite3.Row; db.execute('pragma query_only=on')
        db.set_progress_handler(lambda: int(time.monotonic() > self.deadline), 10000)
        try:
            tables = {r[0] for r in db.execute("select name from sqlite_master where type='table'")}
            for table in ('session_message', 'message'):
                if table not in tables: continue
                name = 'oc:' + table
                mark = self.db.execute('select value from meta where key=?', (name,)).fetchone()
                since = max(0, int(mark[0]) - 60000) if mark else 0
                # V2 rows supersede imported legacy messages, even if V2 has
                # no usage; never sum both versions of the same message.
                exclude = 'and not exists(select 1 from session_message v where v.id=m.id)' if table == 'message' and 'session_message' in tables else ''
                role = "and m.type='assistant'" if table == 'session_message' else "and json_extract(m.data,'$.role')='assistant'"
                query = 'select m.id,m.session_id,m.time_created,m.time_updated,m.data from ' + table + ' m where m.time_updated>=? ' + role + ' ' + exclude + ' order by m.time_updated,m.id limit 60000'
                latest = since; count = 0
                for r in db.execute(query, (since,)):
                    if time.monotonic() > self.deadline: self.pending += 1; break
                    d = json.loads(r['data']); model = obj(d.get('model')); usage = d.get('tokens')
                    directory = d.get('cwd') or d.get('directory') or ''
                    for session_table in ('session_v2', 'session'):
                        if directory or session_table not in tables: continue
                        try:
                            found = db.execute('select directory from ' + session_table + ' where id=?', (r['session_id'],)).fetchone()
                            if found: directory = found[0]
                        except sqlite3.Error: pass
                    e = event(r['id'], 'opencode', r['session_id'], r['time_created'], model.get('id') or model.get('modelID') or d.get('modelID'), model.get('providerID') or d.get('providerID'), usage, project=directory)
                    self.insert(e); latest = max(latest, r['time_updated']); count += 1
                if count >= 60000: self.pending += 1
                self.db.execute('insert or replace into meta values(?,?)', (name, str(latest))); self.db.commit()
        except (sqlite3.Error, ValueError): self.warnings.append('OpenCode no pudo actualizarse; se conserva el historial indexado.'); self.pending += 1
        finally: db.close()

    def refresh(self):
        if self.busy: self.pending += 1; return
        for agent, p, account, stat in self.files():
            if time.monotonic() >= self.deadline: self.pending += 1; continue
            try: self.scan_file(agent, p, account, stat)
            except (OSError, ValueError): self.warnings.append('Un historial no pudo leerse.'); self.pending += 1
        if time.monotonic() < self.deadline: self.scan_opencode()
        else: self.pending += 1

    def report(self, request, catalog, now=None):
        now = now or time.time(); tz = local_zone(request.get('tz', 'America/Argentina/Buenos_Aires')); period = request.get('period', '7')
        today = datetime.fromtimestamp(now, tz).replace(hour=0, minute=0, second=0, microsecond=0)
        start = (today - timedelta(days=(1 if period == 'today' else int(period)) - 1)).timestamp() if period != 'all' else 0
        agent = request.get('agent', 'all'); agent = 'opencode' if agent == 'openchamber' else agent
        clauses = ['at>=?', 'at<=?']; values = [start, now]
        if agent != 'all': clauses.append('agent=?'); values.append(agent)
        for k in ('provider', 'model', 'account'):
            if request.get(k): clauses.append(k + '=?'); values.append(request[k])
        project = request.get('project', '')
        if project:
            if not isinstance(project, str) or not project.startswith('/') or len(project) > 4096: raise ValueError('Proyecto inválido')
            project = os.path.normpath(project); prefix = project.rstrip('/') + '/'
            clauses.append('(project=? or substr(project,1,?)=?)'); values.extend([project, len(prefix), prefix])
        rows = self.db.execute('select * from events where ' + ' and '.join(clauses), values)
        def empty(): return dict(**{k: 0 for k in FIELDS}, total=0, requests=0, usd=0, pricedRequests=0, unpricedRequests=0, components={}, partialRequests=0)
        summary = empty(); groups = {}; days = {}; sessions = set(); unknown = set()
        for raw in rows:
            row = dict(raw); price = catalog.price(row); key = (row['agent'], row['provider'], row['model'], row['account'], price.get('model'), json.dumps(price.get('rates'), sort_keys=True))
            group = groups.setdefault(key, dict(agent=row['agent'], provider=row['provider'], model=row['model'], account=row['account'], accountBasis=row['accountBasis'], priceModel=price.get('model'), priceBasis=price.get('basis'), rates=price.get('rates'), **empty()))
            day = datetime.fromtimestamp(row['at'], tz).date().isoformat(); daily = days.setdefault(day, dict(day=day, **empty()))
            for target in (summary, group, daily):
                for k in FIELDS: target[k] += row[k]
                target['total'] += total(row); target['requests'] += 1
                if price['status'] == 'missing': target['unpricedRequests'] += 1
                else:
                    target['usd'] += price['usd']; target['pricedRequests'] += 1
                    if price['status'] == 'partial': target['partialRequests'] += 1
                    for k, v in price['components'].items(): target['components'][k] = target['components'].get(k, 0) + v
            sessions.add(row['agent'] + ':' + row['session'])
            if price['status'] != 'priced': unknown.add(row['provider'] + '/' + row['model'])
        # Facets stay stable while model/provider/account filters narrow results.
        facet_where = 'where at>=? and at<=?' + (' and agent=?' if agent != 'all' else '')
        facet_values = [start, now] + ([agent] if agent != 'all' else [])
        if project:
            facet_where += ' and (project=? or substr(project,1,?)=?)'; facet_values.extend([project,len(prefix),prefix])
        facets = {k: [r[0] for r in self.db.execute('select distinct ' + k + ' from events ' + facet_where + ' order by ' + k, facet_values)] for k in ('provider', 'model', 'account')}
        bounds = self.db.execute('select min(at),max(at),count(*) from events' + (' where agent=?' if agent != 'all' else ''), [agent] if agent != 'all' else []).fetchone()
        summary['sessions'] = len(sessions)
        account_labels = {'unknown': 'Cuenta no registrada'}
        base = self.home / '.local/share/axon/agent-accounts'
        registry = read_json(base / 'accounts.json')
        for native_agent in ('codex', 'claude'):
            for profile in obj(obj(registry.get('agents')).get(native_agent)).get('profiles', [])[:32]:
                if not isinstance(profile, dict) or not re.fullmatch(r'(?:current|a-[a-f0-9]{16})', str(profile.get('id', ''))): continue
                label = text(profile.get('label')); account_labels['profile:' + profile['id']] = label
                if native_agent == 'codex':
                    # Read only the account identifier for display mapping; no
                    # token or auth payload is persisted in the usage index.
                    auth = read_json(base / 'codex' / profile['id'] / 'auth.json')
                    ident = text(obj(auth.get('tokens')).get('account_id'))
                    if ident: account_labels[ident] = label + ' · cuenta creadora'
        return dict(ok=True, agent=request.get('agent', 'all'), period=period, timezone=str(tz), startAt=start or bounds[0], endAt=now,
                    summary=summary, groups=sorted(groups.values(), key=lambda g: g['total'], reverse=True), daily=sorted(days.values(), key=lambda d: d['day']),
                    facets=facets, prices=catalog.meta, coverage=dict(source='Historial local del servidor', firstAt=bounds[0], lastAt=bounds[1], records=bounds[2],
                    indexing=bool(self.pending or self.busy), pending=self.pending, warnings=list(dict.fromkeys(self.warnings)), scannedFiles=self.scanned,
                    accountAttribution='Cuenta creadora del chat o carpeta del perfil; si no está registrada, no se atribuye a la cuenta activa.',
                    projectAttribution='Sólo rutas de trabajo registradas por el historial nativo. Las solicitudes sin ruta no se atribuyen a un proyecto.',
                    project=project or None,
                    unsupported=['Devin no expone en este host un historial de tokens por modelo.'] if agent in ('devin', 'all') else []),
                    unpricedModels=sorted(unknown), accountLabels=account_labels, generatedAt=now)

def main(request):
    index = Index(request['home'])
    try:
        index.refresh(); catalog = Catalog(index.folder).load(bool(request.get('refreshPrices')))
        return index.report(request, catalog)
    finally: index.close()

if __name__ == '__main__':
    try: print(json.dumps(main(json.load(sys.stdin)), ensure_ascii=False, allow_nan=False))
    except Exception: print(json.dumps({'ok': False, 'error': 'No se pudo leer el consumo de agentes', 'status': 503}))

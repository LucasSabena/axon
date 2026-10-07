#!/usr/bin/env python3
"""Host-only quota readers. Never infer, renew credentials or change accounts.

Provider responses are reduced to an allowlist before entering the private
cache or HTTP response. Native JSON/TOML/SQLite sources are read-only.
"""
import base64
import concurrent.futures
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import time
import tomllib
import types
import urllib.error
import urllib.request
from datetime import datetime, timezone

TTL = 120
MIN_REFRESH = 15
MAX_BODY = 256_000
ENDPOINTS = {
    'codex': 'https://chatgpt.com/backend-api/wham/usage',
    'claude': 'https://api.anthropic.com/api/oauth/usage',
    'opencode-go': 'https://opencode.ai/zen/go/v1/usage',
    'devin': 'https://app.devin.ai',
    'minimax-coding-plan': 'https://api.minimax.io/v1/api/openplatform/coding_plan/remains',
    'github-copilot': 'https://api.github.com/copilot_internal/user',
}
LINKS = {
    'codex': 'https://chatgpt.com/codex/settings/usage',
    'claude': 'https://claude.ai/settings/usage',
    'opencode-go': 'https://opencode.ai/console',
    'opencode': 'https://opencode.ai/console',
    'devin': 'https://app.devin.ai/settings/usage',
    'minimax-coding-plan': 'https://platform.minimax.io/user-center/payment/coding-plan',
    'github-copilot': 'https://github.com/settings/copilot',
}


def number(value):
    if isinstance(value, bool): return None
    try:
        result = float(value)
        return result if math.isfinite(result) and result >= 0 else None
    except (ValueError, TypeError): return None


def text(value, size=120):
    return ''.join(c for c in value[:size] if ord(c) >= 32) if isinstance(value, str) else None


def timestamp(value):
    n = number(value)
    if n is not None: return int(n / 1000 if n > 10_000_000_000 else n)
    try:
        d = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return int((d if d.tzinfo else d.replace(tzinfo=timezone.utc)).timestamp())
    except (ValueError, TypeError, AttributeError): return None


def claims(token):
    try:
        p = token.split('.')[1]
        data = json.loads(base64.urlsafe_b64decode(p + '=' * (-len(p) % 4)))
        return data if isinstance(data, dict) else {}
    except (ValueError, IndexError, TypeError, AttributeError): return {}


def window(ident, label, percent, reset=None, duration=None):
    used = number(percent)
    if used is None: return None  # Unknown is never 0% used / 100% remaining.
    return {'id': ident, 'label': label, 'usedPercent': used,
            'remainingPercent': max(0, 100 - used), 'resetsAt': timestamp(reset),
            'windowSeconds': number(duration)}


def normalize_codex(data, now):
    windows = []
    buckets = [('codex', '', data.get('rate_limit') or {})]
    review = data.get('code_review_rate_limit')
    if isinstance(review, dict): buckets.append(('review', 'Code review · ', review))
    for i, extra in enumerate((data.get('additional_rate_limits') or [])[:12]):
        if isinstance(extra, dict):
            buckets.append(('extra-' + str(i), (text(extra.get('limit_name')) or 'Otra cuota') + ' · ', extra.get('rate_limit') or {}))
    for bucket, prefix, limits in buckets:
        for key, default in [('primary_window', 'Sesión'), ('secondary_window', 'Semanal')]:
            w = limits.get(key)
            if not isinstance(w, dict): continue
            duration = number(w.get('limit_window_seconds'))
            label = 'Semanal' if duration == 604800 else 'Mensual' if duration and duration >= 2_419_200 else f'{duration / 3600:g} horas' if duration and duration % 3600 == 0 else default
            reset = w.get('reset_at')
            if reset is None and number(w.get('reset_after_seconds')) is not None: reset = now + number(w['reset_after_seconds'])
            row = window(bucket + '-' + key, prefix + label, w.get('used_percent'), reset, duration)
            if row: windows.append(row)
    credits = data.get('credits') or {}
    balances = []
    if number(credits.get('balance')) is not None:
        balances.append({'label': 'Créditos adicionales', 'remaining': number(credits['balance']), 'unit': 'créditos'})
    grants = data.get('rate_limit_reset_credits') or {}
    resets = number(grants.get('available_count'))
    return {'plan': text(data.get('plan_type')), 'windows': windows, 'balances': balances,
            'extraUsageEnabled': bool(credits.get('has_credits') or credits.get('unlimited')),
            'availableResets': resets}


def normalize_claude(data, now):
    windows = []
    known = [('five_hour', '5 horas', 18000), ('seven_day', 'Semanal', 604800),
             ('seven_day_opus', 'Semanal · Opus', 604800), ('seven_day_sonnet', 'Semanal · Sonnet', 604800),
             ('seven_day_oauth_apps', 'Semanal · Apps OAuth', 604800), ('seven_day_cowork', 'Semanal · Cowork', 604800)]
    for ident, label, duration in known:
        w = data.get(ident)
        if not isinstance(w, dict): continue
        row = window(ident, label, w.get('utilization'), w.get('resets_at'), duration)
        if row: windows.append(row)
    # New CLI usage schema: fall back only for windows absent from the legacy view.
    mapping = {'session': ('five_hour', '5 horas', 18000), 'weekly_all': ('seven_day', 'Semanal', 604800),
               'weekly_opus': ('seven_day_opus', 'Semanal · Opus', 604800), 'weekly_sonnet': ('seven_day_sonnet', 'Semanal · Sonnet', 604800)}
    for w in (data.get('limits') or [])[:20]:
        if not isinstance(w, dict) or w.get('kind') not in mapping: continue
        ident, label, duration = mapping[w['kind']]
        if any(x['id'] == ident for x in windows): continue
        row = window(ident, label, w.get('percent'), w.get('resets_at'), duration)
        if row: windows.append(row)
    extra = data.get('extra_usage') or {}
    spend = data.get('spend') or {}
    balances = []
    money = spend.get('balance')
    if isinstance(money, dict) and number(money.get('amount_minor')) is not None and number(money.get('exponent')) in [0, 1, 2, 3]:
        balances.append({'label': 'Saldo de uso extra', 'remaining': number(money['amount_minor']) / 10 ** int(money['exponent']), 'unit': text(money.get('currency')) or 'unidades'})
    return {'windows': windows, 'balances': balances, 'extraUsageEnabled': bool(extra.get('is_enabled') or spend.get('enabled'))}


def normalize_go(data, now):
    windows = []
    for ident, label, duration in [('rolling', '5 horas', 18000), ('weekly', 'Semanal', 604800), ('monthly', 'Mensual', None)]:
        w = (data.get('usage') or {}).get(ident)
        if not isinstance(w, dict): continue
        reset = w.get('resetsAt')
        if reset is None and number(w.get('resetInSec')) is not None: reset = now + number(w['resetInSec'])
        row = window(ident, label, w.get('percent', w.get('usagePercent')), reset, duration)
        if row: windows.append(row)
    return {'windows': windows, 'balances': [], 'plan': text(data.get('plan'))}


def normalize_devin(data, now):
    windows = []
    for key, label, duration in [('daily', 'Diaria', 86400), ('weekly', 'Semanal', 604800), ('monthly', 'Mensual', None)]:
        if key == 'daily' and data.get('hide_daily_quota') is True: continue
        used = number(data.get(key + '_percentage'))
        if used is not None:
            # The quota endpoint uses fractions at or below 1, percent above
            # it — a fully used quota reports 1.0, not 100.
            row = window(key, label, used * 100 if used <= 1 else used, data.get(key + '_reset_at'), duration)
            if row: windows.append(row)
    balances = []
    remaining = number(data.get('overage_balance'))
    if remaining is None and number(data.get('overage_balance_cents')) is not None: remaining = number(data['overage_balance_cents']) / 100
    if remaining is not None: balances.append({'label': 'Saldo adicional', 'remaining': remaining, 'unit': 'USD'})
    return {'windows': windows, 'balances': balances, 'plan': text(data.get('plan_name') or data.get('plan'))}


def normalize_minimax(data, now):
    payload = data.get('data') or data; windows = []
    for i, model in enumerate((payload.get('model_remains') or [])[:12]):
        name = text(model.get('model_name')) or 'Coding plan'
        for prefix, label, end in [('current_interval', 'Sesión', 'end_time'), ('current_weekly', 'Semanal', 'weekly_end_time')]:
            total = number(model.get(prefix + '_total_count'))
            # MiniMax's *_usage_count is remaining allowance, not used allowance.
            remaining = number(model.get(prefix + '_usage_count'))
            if not total or remaining is None: continue
            row = window(str(i) + '-' + prefix, name + ' · ' + label, max(0, (total - remaining) / total * 100), model.get(end))
            if row: windows.append(row)
    return {'windows': windows, 'balances': [], 'plan': text(payload.get('current_subscribe_title') or payload.get('plan_name'))}


def normalize_copilot(data, now):
    windows = []; notes = []
    reset = data.get('quota_reset_date_utc') or data.get('quota_reset_date')
    for key, label in [('premium_interactions', 'Premium'), ('chat', 'Chat'), ('completions', 'Completions')]:
        q = (data.get('quota_snapshots') or {}).get(key)
        if not isinstance(q, dict): continue
        if q.get('unlimited') is True:
            notes.append(label + ': sin límite informado por GitHub'); continue
        remaining = number(q.get('percent_remaining'))
        if remaining is None: continue
        row = window(key, 'Mensual · ' + label, max(0, 100 - remaining), reset)
        if row: windows.append(row)
    return {'windows': windows, 'balances': [], 'plan': text(data.get('copilot_plan')), 'notes': notes}


class QuotaError(Exception):
    def __init__(self, state='unavailable', retry=None): self.state = state; self.retry = retry


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs): return None


def fetch(provider, credential):
    # Never use URLs from native config, credential metadata or client input.
    url = ENDPOINTS[provider]
    headers = {'Accept': 'application/json', 'User-Agent': 'axon-quota/1', 'Authorization': 'Bearer ' + credential['access']}
    if provider == 'codex' and credential.get('accountId'): headers['ChatGPT-Account-Id'] = credential['accountId']
    if provider == 'claude': headers['anthropic-beta'] = 'oauth-2025-04-20'
    if provider == 'github-copilot':
        headers.update({'Authorization': 'token ' + credential['access'], 'Editor-Version': 'vscode/1.96.2',
                        'Editor-Plugin-Version': 'copilot-chat/0.26.7', 'User-Agent': 'GitHubCopilotChat/0.26.7', 'X-Github-Api-Version': '2025-04-01'})
    if provider == 'devin':
        org = credential.get('organization') or ''
        if not re.fullmatch(r'(?:org[-_])?[A-Za-z0-9_-]{1,120}', org): raise QuotaError('not_connected')
        url += '/api/' + org + '/billing/quota/usage'
        headers['x-cog-org-id'] = org
    try:
        opener = urllib.request.build_opener(NoRedirect())
        with opener.open(urllib.request.Request(url, headers=headers), timeout=6) as response:
            raw = response.read(MAX_BODY + 1)
            if len(raw) > MAX_BODY: raise QuotaError()
            data = json.loads(raw)
            if not isinstance(data, dict): raise QuotaError()
            if provider == 'minimax-coding-plan':
                status = (data.get('base_resp') or {}).get('status_code', 0)
                if status: raise QuotaError('reconnect' if status == 1004 else 'unavailable')
            actual = data.get('account_id') or data.get('accountId')
            if actual and credential.get('accountId') and actual != credential['accountId']: raise QuotaError('identity_mismatch')
            return data
    except urllib.error.HTTPError as e:
        retry = number(e.headers.get('Retry-After'))
        if e.code == 429: raise QuotaError('rate_limited', min(3600, max(60, retry or 120))) from None
        raise QuotaError('reconnect' if e.code == 401 else 'permission' if e.code == 403 else 'unavailable') from None
    except (OSError, ValueError, TimeoutError): raise QuotaError() from None


class Collector:
    def __init__(self, store, *, request=fetch, clock=time.time):
        self.store = store; self.request = request; self.clock = clock
        self.cache = store.home / '.cache/axon/agent-usage'
        self.accounts = sys.modules[store.__class__.__module__]

    def json(self, path): return self.accounts.read_json(path)

    def entry(self, ident, provider, label, credential, *, account=None, active=None, plan=None, source='Login local', account_id=None):
        claim = claims(credential.get('access', ''))
        auth = claim.get('https://api.openai.com/auth') or {}
        profile = claim.get('https://api.openai.com/profile') or {}
        return {'id': ident, 'provider': provider, 'label': text(label), 'email': text(account or claim.get('email') or profile.get('email')),
                'active': active, 'plan': text(plan or auth.get('chatgpt_plan_type')), 'credentialSource': source,
                'accountId': text(account_id or credential.get('accountId'), 180), 'credential': credential,
                'dashboardUrl': LINKS.get(provider), 'source': 'API del proveedor' if provider in ENDPOINTS else 'Login local'}

    def profiles(self, agent):
        listing = self.store.listing(agent); entries = []
        for p in listing['profiles']:
            root = Path(p['home'])
            if agent == 'codex':
                auth = self.json(root / 'auth.json'); t = auth.get('tokens') or {}
                cred = {'access': t.get('access_token') or '', 'accountId': t.get('account_id')}
                if not cred['access']: cred = {}  # An API key is not a ChatGPT quota login.
                plan = None
            else:
                auth = self.json(root / '.credentials.json').get('claudeAiOauth') or {}
                cred = {'access': auth.get('accessToken') or ''}; plan = auth.get('subscriptionType')
            row = self.entry(p['id'], agent if p.get('method') != 'API' else 'openai-api', p['label'], cred, account=p.get('email'), active=p['active'], plan=plan,
                             source='Cuenta guardada en AXON')
            if agent == 'claude' and auth.get('rateLimitTier'): row['rateLimitTier'] = text(auth['rateLimitTier'])
            entries.append(row)
        return entries

    def opencode(self):
        root = self.store.home / '.local/share/opencode'; entries = []; seen = set()
        db = self.accounts.safe(root / 'opencode.db')
        if db.exists():
            with sqlite3.connect(db.as_uri() + '?mode=ro', uri=True, timeout=.5) as connection:
                connection.execute('pragma query_only=on')
                tables = {r[0] for r in connection.execute("select name from sqlite_master where type='table'")}
                if 'credential' in tables:
                    for ident, provider, label, value, active in connection.execute('select id,integration_id,label,value,active from credential order by time_created limit 100'):
                        if provider.startswith('mcp_'): continue
                        try: cred = json.loads(value)
                        except (ValueError, TypeError): cred = {}
                        entries.append(self.opencode_entry(ident, provider, label, cred, bool(active), 'OpenCode V2 · SQLite'))
                        seen.add(provider)
        for provider, cred in self.json(root / 'auth.json').items():
            if provider not in seen and isinstance(cred, dict):
                entries.append(self.opencode_entry('legacy-' + provider, provider, provider, cred, None, 'OpenCode · auth.json'))
        return entries[:32]

    def opencode_entry(self, ident, provider, label, cred, active, source):
        if not isinstance(cred, dict): cred = {}
        adapter = {'openai': 'codex', 'anthropic': 'claude', 'opencode-go': 'opencode-go', 'opencode': 'opencode'}.get(provider, provider)
        if provider in ['openai', 'anthropic'] and cred.get('type') not in ['oauth']:
            adapter = provider + '-api'
        meta = cred.get('metadata') or {}
        normalized = {'access': cred.get('access') or cred.get('key') or '', 'accountId': cred.get('accountId') or meta.get('accountId')}
        if provider == 'github-copilot': normalized['access'] = cred.get('refresh') or cred.get('access') or ''
        title = {'codex': 'ChatGPT / Codex', 'claude': 'Claude', 'opencode-go': 'OpenCode Go', 'opencode': 'OpenCode Zen'}.get(adapter, provider)
        return self.entry(ident, adapter, title if label in ['OAuth', 'API key', provider] else title + ' · ' + label,
                          normalized, active=active, source=source)

    def devin(self):
        path = self.accounts.safe(self.store.home / '.local/share/devin/credentials.toml')
        entries = []
        if path.exists():
            if path.stat().st_size > MAX_BODY: raise QuotaError()
            auth = tomllib.loads(path.read_text())
            row = self.entry('devin-local', 'devin', 'Devin CLI', {}, source='Devin · credentials.toml')
            row['authMethod'] = 'Windsurf' if auth.get('windsurf_api_key') else 'Devin'
            entries.append(row)
        saved = self.json(self.store.root / 'usage-connections.json')
        for row in saved.get('devin', [])[:12]:
            entries.append(self.entry(row['id'], 'devin', row['label'], {'access': row['accessToken'], 'organization': row['organization']},
                                      source='Conexión de consulta', account_id=row['organization']))
        return entries

    def snapshot(self, entry, force=False):
        now = int(self.clock()); credential = entry['credential']
        public = {k: v for k, v in entry.items() if k != 'credential'}
        empty = {'windows': [], 'balances': [], 'checkedAt': now, 'fetchedAt': None, 'status': 'unsupported', 'stale': False}
        if entry['provider'] not in ENDPOINTS: return {**public, **empty}
        if not credential.get('access'): return {**public, **empty, 'status': 'not_connected'}
        fingerprint = hashlib.sha256(json.dumps([entry['provider'], credential], sort_keys=True).encode()).hexdigest()
        self.accounts.private_dir(self.cache)
        target = self.cache / (fingerprint + '.json')
        old = self.json(target)
        if old and (now < old.get('blockedUntil', 0) or now - old.get('checkedAt', 0) < (MIN_REFRESH if force else old.get('ttl', TTL))):
            return self.present(public, old, now)
        fd = os.open(self.accounts.safe(self.cache / (fingerprint + '.lock')), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: return self.present(public, old or {**empty, 'status': 'loading'}, now)
            # Another request can have completed between the initial read and lock.
            old = self.json(target)
            if old and (now < old.get('blockedUntil', 0) or now - old.get('checkedAt', 0) < (MIN_REFRESH if force else old.get('ttl', TTL))): return self.present(public, old, now)
            try:
                raw = self.request(entry['provider'], credential)
                normalized = {'codex': normalize_codex, 'claude': normalize_claude, 'opencode-go': normalize_go, 'devin': normalize_devin,
                              'minimax-coding-plan': normalize_minimax, 'github-copilot': normalize_copilot}[entry['provider']](raw, now)
                if not normalized['windows'] and not normalized['balances'] and not normalized.get('notes'): raise QuotaError('unsupported')
                result = {**normalized, 'checkedAt': now, 'fetchedAt': now, 'status': 'ok', 'ttl': TTL}
            except QuotaError as e:
                # Preserve a successful observation on failure, with its original timestamp.
                result = {**(old or empty), 'checkedAt': now, 'status': e.state, 'ttl': 60}
                if e.state == 'identity_mismatch': result.update(windows=[], balances=[], fetchedAt=None)
                if e.retry: result['blockedUntil'] = now + int(e.retry)
            except (ValueError, TypeError, AttributeError):
                result = {**(old or empty), 'checkedAt': now, 'status': 'unavailable', 'ttl': 60}
            self.accounts.atomic(target, json.dumps(result) + '\n')
            return self.present(public, result, now)
        finally: os.close(fd)

    def present(self, public, snapshot, now):
        result = {**public, **{k: v for k, v in snapshot.items() if k not in ['ttl', 'blockedUntil']}}
        # A provider reset doesn't prove the meter has returned to 100%.
        expired = any(w.get('resetsAt') is not None and w['resetsAt'] <= now for w in result.get('windows', []))
        result['stale'] = bool(result.get('fetchedAt') and (result['status'] != 'ok' or now - result['fetchedAt'] >= TTL or expired))
        result['nextCheckAt'] = max(snapshot.get('checkedAt', now) + snapshot.get('ttl', TTL), snapshot.get('blockedUntil', 0))
        if not result.get('plan'): result['plan'] = public.get('plan')
        return result

    def prune_cache(self):
        # Fingerprints embed the credential, so every rotation orphans the old
        # cache+lock pair. Drop files untouched for a week; the cap keeps the
        # directory bounded even under churn.
        try:
            cutoff = self.clock() - 7 * 86400
            stale = []
            for p in self.cache.iterdir():
                if p.is_symlink() or p.suffix not in ('.json', '.lock'): continue
                try:
                    if p.stat().st_mtime < cutoff: stale.append(p)
                except OSError: continue
            for p in stale[:512]:
                try:
                    if p.suffix == '.lock':
                        # An actively-held lock survives unlink() but a new
                        # open would start a second flock domain — only drop
                        # locks we can acquire first.
                        fd = os.open(p, os.O_RDWR | os.O_NOFOLLOW)
                        try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        except BlockingIOError: os.close(fd); continue
                        os.close(fd)
                    p.unlink()
                except OSError: continue
        except OSError: pass

    def collect(self, agent, force=False):
        if agent in ['codex', 'claude']: entries = self.profiles(agent)
        elif agent in ['opencode', 'openchamber']: entries = self.opencode()
        elif agent == 'devin': entries = self.devin()
        else: raise self.accounts.Failure('Este agente no tiene un lector de cuotas', 404)
        self.prune_cache()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            snapshots = list(executor.map(lambda e: self.snapshot(e, force), entries))
        return {'ok': True, 'agent': agent, 'accounts': snapshots, 'updatedAt': int(self.clock()), 'refreshSeconds': TTL,
                'canConnectUsage': agent == 'devin'}

    def connect(self, request):
        if request['agent'] != 'devin': raise self.accounts.Failure('Conexión de consulta no admitida', 404)
        path = self.store.root / 'usage-connections.json'
        with self.store.lock():
            saved = self.json(path); rows = saved.setdefault('devin', [])
            if request['action'] == 'disconnect':
                ident = request.get('id')
                if not isinstance(ident, str) or not re.fullmatch(r'u-[a-f0-9]{16}', ident): raise self.accounts.Failure('Conexión inválida')
                if not any(row['id'] == ident for row in rows): raise self.accounts.Failure('Conexión no encontrada', 404)
                saved['devin'] = [row for row in rows if row['id'] != ident]
            else:
                label = self.accounts.label(request.get('label'))
                org = request.get('organization'); token = request.get('accessToken')
                if isinstance(token, str) and token.lower().startswith('bearer '): token = token[7:].strip()
                if not isinstance(org, str) or not re.fullmatch(r'(?:org[-_])?[A-Za-z0-9_-]{1,120}', org): raise self.accounts.Failure('Usá el ID de organización de Devin, sin URL')
                if not isinstance(token, str) or not 20 <= len(token) <= 16000 or any(ord(c) <= 32 for c in token): raise self.accounts.Failure('Token de consulta inválido')
                if len(rows) >= 12: raise self.accounts.Failure('Máximo de 12 conexiones de consulta')
                rows.append({'id': 'u-' + secrets.token_hex(8), 'label': label, 'organization': org, 'accessToken': token})
            self.accounts.atomic(path, json.dumps(saved) + '\n')
        return self.collect('devin')


def main():
    request = json.load(sys.stdin)
    accounts = types.ModuleType('axon_usage_accounts'); sys.modules[accounts.__name__] = accounts
    exec(compile(request['accountsSource'], 'agent-accounts.py', 'exec'), accounts.__dict__)
    try:
        collector = Collector(accounts.Store(request['home']))
        result = collector.connect(request) if request.get('action') in ['connect', 'disconnect'] else collector.collect(request['agent'], request.get('refresh') is True)
        print(json.dumps(result, ensure_ascii=False))
    except accounts.Failure as e: print(json.dumps({'ok': False, 'status': e.status, 'error': str(e)}))
    except (OSError, ValueError, TypeError, sqlite3.Error, QuotaError):
        print(json.dumps({'ok': False, 'status': 503, 'error': 'No se pudieron leer las cuentas y sus cuotas'}))


if __name__ == '__main__': main()

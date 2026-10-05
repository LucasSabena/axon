import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    m = importlib.util.module_from_spec(spec); sys.modules[name] = m; spec.loader.exec_module(m); return m


accounts = module('usage_accounts_test', 'agent-accounts.py')
usage = module('usage_test', 'agent-usage.py')


class Quotas(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='axon-usage-test-')
        self.home = Path(self.temp.name); self.store = accounts.Store(self.home)
        self.now = 1791140000; self.calls = []
        def request(provider, credential):
            self.calls.append((provider, credential['access']))
            return {'plan_type': 'plus', 'rate_limit': {'primary_window': {'used_percent': 25, 'limit_window_seconds': 18000, 'reset_at': self.now + 3600}, 'secondary_window': {'used_percent': 80, 'limit_window_seconds': 604800, 'reset_at': self.now + 86400}}}
        self.collector = usage.Collector(self.store, request=request, clock=lambda: self.now)
        self.entry = self.collector.entry('current', 'codex', 'Personal', {'access': 'private-personal-token', 'accountId': 'personal'})

    def tearDown(self): self.temp.cleanup()

    def test_windows_units_missing_values_and_separate_balances(self):
        codex = usage.normalize_codex({'rate_limit': {'primary_window': {'used_percent': 0, 'limit_window_seconds': 18000, 'reset_after_seconds': 50}}, 'credits': {'balance': '9.5'}, 'rate_limit_reset_credits': {'available_count': 2}}, self.now)
        self.assertEqual(codex['windows'][0]['remainingPercent'], 100)
        self.assertEqual(codex['windows'][0]['resetsAt'], self.now + 50)
        self.assertEqual(codex['balances'][0]['unit'], 'créditos')
        self.assertEqual(codex['availableResets'], 2)
        self.assertEqual(usage.normalize_codex({'rate_limit': {'primary_window': {'used_percent': None}}}, self.now)['windows'], [])
        self.assertIsNone(usage.number(True)); self.assertIsNone(usage.number('NaN'))
        self.assertEqual(usage.window('over', 'Over', 105)['remainingPercent'], 0)
        claude = usage.normalize_claude({'five_hour': {'utilization': 7, 'resets_at': '2026-10-04T22:10:00Z'}, 'seven_day_opus': None, 'limits': [{'kind': 'session', 'percent': 10}, {'kind': 'weekly_all', 'percent': 42}]}, self.now)
        self.assertEqual([w['usedPercent'] for w in claude['windows']], [7, 42])
        self.assertEqual(claude['windows'][0]['resetsAt'], usage.timestamp('2026-10-04T22:10:00+00:00'))
        go = usage.normalize_go({'usage': {'rolling': {'percent': 75, 'resetInSec': 45}, 'weekly': {'percent': 20}, 'monthly': {'percent': 40, 'resetsAt': '2026-11-01T00:00:00Z'}}}, self.now)
        self.assertEqual([w['remainingPercent'] for w in go['windows']], [25, 80, 60])
        self.assertIsNone(go['windows'][1]['resetsAt'])
        devin = usage.normalize_devin({'hide_daily_quota': True, 'daily_percentage': .4, 'weekly_percentage': .7, 'overage_balance_cents': 235}, self.now)
        self.assertEqual(len(devin['windows']), 1); self.assertEqual(devin['windows'][0]['remainingPercent'], 30)
        self.assertEqual(devin['balances'][0]['remaining'], 2.35)
        minimax = usage.normalize_minimax({'model_remains': [{'model_name': 'fixture', 'current_interval_total_count': 100, 'current_interval_usage_count': 70}]}, self.now)
        self.assertEqual(minimax['windows'][0]['remainingPercent'], 70)
        copilot = usage.normalize_copilot({'quota_snapshots': {'premium_interactions': {'percent_remaining': 65}, 'chat': {'unlimited': True}}, 'quota_reset_date_utc': '2026-11-01'}, self.now)
        self.assertEqual(copilot['windows'][0]['usedPercent'], 35); self.assertEqual(len(copilot['notes']), 1)

    def test_cache_is_account_scoped_private_and_does_not_contain_tokens(self):
        first = self.collector.snapshot(self.entry)
        again = self.collector.snapshot(self.entry, True)
        company = self.collector.entry('company', 'codex', 'Empresa', {'access': 'private-company-token', 'accountId': 'company'})
        other = self.collector.snapshot(company)
        self.assertEqual(len(self.calls), 2); self.assertEqual(first['accountId'], 'personal'); self.assertEqual(other['accountId'], 'company')
        self.assertEqual(again['fetchedAt'], first['fetchedAt'])
        for f in self.collector.cache.glob('*.json'):
            self.assertEqual(f.stat().st_mode & 0o777, 0o600)
            self.assertNotIn('private-', f.read_text()); self.assertNotIn('refresh', f.read_text())
        self.entry['credential']['access'] = 'renewed-personal-token'
        self.collector.snapshot(self.entry); self.assertEqual(len(self.calls), 3)

    def test_failures_preserve_observation_but_not_freshness_and_obey_retry_after(self):
        first = self.collector.snapshot(self.entry)
        self.now += 130
        def fail(*_): raise usage.QuotaError('rate_limited', 600)
        self.collector.request = fail
        blocked = self.collector.snapshot(self.entry)
        self.assertEqual(blocked['fetchedAt'], first['fetchedAt']); self.assertTrue(blocked['stale'])
        self.assertEqual(blocked['status'], 'rate_limited')
        self.assertEqual(blocked['nextCheckAt'], self.now + 600)
        self.collector.request = lambda *_: self.fail('A manual refresh must obey provider backoff')
        self.now += 20; self.collector.snapshot(self.entry, True)

    def test_past_reset_is_not_promoted_to_full_and_wrong_identity_is_discarded(self):
        first = self.collector.snapshot(self.entry)
        self.now += 3601
        old = self.collector.present(self.entry, first, self.now)
        self.assertTrue(old['stale']); self.assertEqual(old['windows'][0]['remainingPercent'], 75)
        def fail(*_): raise usage.QuotaError('identity_mismatch')
        self.collector.request = fail
        rejected = self.collector.snapshot(self.entry, True)
        self.assertEqual(rejected['windows'], []); self.assertIsNone(rejected['fetchedAt'])

    def test_v2_credentials_are_authoritative_multiple_accounts_are_retained_and_mcp_is_excluded(self):
        root = self.home / '.local/share/opencode'; root.mkdir(parents=True)
        (root / 'auth.json').write_text(json.dumps({'openai': {'access': 'obsolete-token'}}))
        db = root / 'opencode.db'
        with sqlite3.connect(db) as c:
            c.execute('create table credential(id text,integration_id text,label text,value text,active integer,time_created integer)')
            for i, provider in enumerate(['openai', 'openai', 'opencode-go', 'mcp_private']):
                c.execute('insert into credential values(?,?,?,?,?,?)', ('cred-' + str(i), provider, 'OAuth', json.dumps({'type': 'oauth', 'access': 'native-' + str(i), 'metadata': {'accountId': 'account-' + str(i)}}), int(i == 1), i))
        original = db.read_bytes()
        entries = self.collector.opencode()
        self.assertEqual(len(entries), 3); self.assertEqual([e['credential']['access'] for e in entries], ['native-0', 'native-1', 'native-2'])
        self.assertEqual(entries[0]['credential']['accountId'], 'account-0')
        self.assertTrue(entries[1]['active']); self.assertEqual(db.read_bytes(), original)

    def test_unconnected_profiles_never_contact_providers_or_mutate_credentials(self):
        before = list(self.home.rglob('*'))
        result = self.collector.collect('codex')
        self.assertEqual(result['accounts'][0]['status'], 'not_connected'); self.assertEqual(self.calls, [])
        self.assertEqual(list(self.home.rglob('*')), before)

    def test_invalid_devin_connection_cannot_write_or_route_credentials_to_another_host(self):
        for org in ['https://evil.test', '../other', 'org/test', 'org\nheader']:
            with self.assertRaises(accounts.Failure):
                self.collector.connect({'agent': 'devin', 'action': 'connect', 'label': 'Empresa', 'organization': org, 'accessToken': 'private-session-token-123'})
        self.assertFalse((self.store.root / 'usage-connections.json').exists())
        self.collector.request = lambda *_: {'weekly_percentage': 35}
        result = self.collector.connect({'agent': 'devin', 'action': 'connect', 'label': 'Empresa', 'organization': 'org-test', 'accessToken': 'private-session-token-123'})
        self.assertNotIn('private-session', json.dumps(result))
        p = self.store.root / 'usage-connections.json'; self.assertEqual(p.stat().st_mode & 0o777, 0o600)
        self.collector.connect({'agent': 'devin', 'action': 'disconnect', 'id': result['accounts'][0]['id']})
        self.assertNotIn('private-session', p.read_text())


if __name__ == '__main__': unittest.main()

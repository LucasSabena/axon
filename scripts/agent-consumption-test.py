import importlib.util
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('consumption', Path(__file__).with_name('agent-consumption.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class Consumption(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='axon-consumption-test-'); self.home = Path(self.tmp.name); self.index = m.Index(self.home)
        self.catalog = m.Catalog(self.index.folder, now=1791158400, fetch=lambda: {
            'openai': {'models': {'gpt-test': {'cost': {'input': 2, 'output': 10, 'cache_read': .2, 'cache_write': 2.5,
                'tiers': [{'tier': {'type': 'context', 'size': 272000}, 'input': 4, 'output': 15, 'cache_read': .4, 'cache_write': 5}]}}, 'gpt-free': {'cost': {'input': 0, 'output': 0}}}},
            'anthropic': {'models': {'claude-test': {'cost': {'input': 4, 'output': 20, 'cache_read': .2, 'cache_write': 5}}}},
            'github-copilot': {'models': {'gpt-test': {'cost': {'input': 0, 'output': 0}, 'canonical_model_id': 'openai/gpt-test'}}},
        }).load()
    def tearDown(self): self.index.close(); self.tmp.cleanup()
    def write(self, path, records):
        path = self.home / path; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(''.join(json.dumps(x) + '\n' for x in records)); return path
    def codex(self, at='2026-10-04T03:00:00Z', total=100, last=100):
        return {'type': 'event_msg', 'timestamp': at, 'payload': {'type': 'token_count', 'info': {'total_token_usage': {'input_tokens': total, 'output_tokens': 10},
            'last_token_usage': {'input_tokens': last, 'cached_input_tokens': 60, 'cache_write_input_tokens': 5, 'output_tokens': 10, 'reasoning_output_tokens': 3}}}}
    def test_codex_dedup_cumulative_fallback_model_changes_and_incremental_tail(self):
        record = self.codex(); records = [{'type': 'session_meta', 'payload': {'id': 'session', 'creator_account_id': 'creator'}}, {'type': 'turn_context', 'payload': {'model': 'gpt-test'}}, record, record]
        p = self.write('.codex/sessions/test.jsonl', records); self.index.refresh()
        row = dict(self.index.db.execute('select * from events').fetchone())
        self.assertEqual((row['input'], row['cacheRead'], row['cacheWrite'], row['output'], row['reasoning']), (35, 60, 5, 10, 3))
        self.assertEqual(row['account'], 'creator'); self.assertEqual(row['accountBasis'], 'creator')
        self.assertEqual(self.index.db.execute('select count(*) from events').fetchone()[0], 1)
        with p.open('a') as f:
            f.write(json.dumps({'type': 'turn_context', 'payload': {'model': 'unpriced'}}) + '\n')
            next_record = {'type': 'event_msg', 'timestamp': '2026-10-04T03:01:00Z', 'payload': {'type': 'token_count', 'info': {'total_token_usage': {'input_tokens': 150, 'output_tokens': 15}}}}
            f.write(json.dumps(next_record))
        self.index.refresh(); self.assertEqual(self.index.db.execute('select count(*) from events').fetchone()[0], 1)
        with p.open('a') as f: f.write('\n')
        self.index.refresh(); rows = self.index.db.execute('select * from events order by at').fetchall()
        self.assertEqual((rows[1]['model'], rows[1]['input'], rows[1]['output']), ('unpriced', 50, 5))
        self.index.refresh(); self.assertEqual(self.index.db.execute('select count(*) from events').fetchone()[0], 2)
        copy = self.home / '.codex/archived_sessions/copy.jsonl'; copy.parent.mkdir(); copy.write_bytes(p.read_bytes()); self.index.refresh()
        self.assertEqual(self.index.db.execute('select count(*) from events').fetchone()[0], 2)

    def test_claude_content_block_dedup_and_hour_cache_price(self):
        record = {'type': 'assistant', 'timestamp': '2026-10-04T03:00:00Z', 'sessionId': 'claude', 'requestId': 'req',
                  'message': {'id': 'response', 'model': 'claude-test', 'usage': {'input_tokens': 100, 'output_tokens': 20, 'cache_read_input_tokens': 200,
                    'cache_creation_input_tokens': 1000, 'cache_creation': {'ephemeral_1h_input_tokens': 800}, 'output_tokens_details': {'thinking_tokens': 5}}, 'content': [{'text': 'PRIVATE PROMPT NEVER INDEXED'}]}}
        self.write('.claude/projects/project/chat.jsonl', [record, record, record]); self.index.refresh()
        rows = self.index.db.execute('select * from events').fetchall(); self.assertEqual(len(rows), 1)
        price = self.catalog.price(dict(rows[0])); self.assertAlmostEqual(price['usd'], .0004 + .0004 + .00004 + .0074)
        self.assertEqual(rows[0]['account'], 'unknown')
        self.assertNotIn(b'PRIVATE PROMPT', (self.index.folder / 'index.sqlite').read_bytes())

    def test_opencode_v2_supersedes_legacy_and_never_writes_native(self):
        path = self.home / '.local/share/opencode/opencode.db'; path.parent.mkdir(parents=True)
        db = sqlite3.connect(path)
        db.execute('create table message(id text,session_id text,time_created integer,time_updated integer,data text)')
        db.execute('create table session_message(id text,session_id text,type text,time_created integer,time_updated integer,data text)')
        usage = {'tokens': {'input': 40, 'output': 10, 'reasoning': 5, 'cache': {'read': 60, 'write': 10}}, 'model': {'id': 'gpt-test', 'providerID': 'github-copilot'}}
        db.execute('insert into session_message values(?,?,?,?,?,?)', ('same', 'oc', 'assistant', 1791072000000, 1791072000000, json.dumps(usage)))
        db.execute('insert into message values(?,?,?,?,?)', ('same', 'oc', 1791072000000, 1791072000000, json.dumps({**usage, 'role': 'assistant'})))
        db.commit(); db.close(); before = path.read_bytes()
        self.index.scan_opencode(); self.index.scan_opencode(); rows = self.index.db.execute('select * from events').fetchall()
        self.assertEqual(len(rows), 1); self.assertEqual(rows[0]['output'], 15); self.assertEqual(m.total(dict(rows[0])), 125)
        self.assertEqual(path.read_bytes(), before)
        price = self.catalog.price(dict(rows[0])); self.assertEqual(price['model'], 'openai/gpt-test'); self.assertGreater(price['usd'], 0)

    def test_pricing_context_exact_model_unknown_partial_and_free(self):
        row = m.event('x', 'codex', 'session', '2026-10-04T03:00:00Z', 'gpt-test', 'openai', {'input_tokens': 300000, 'cached_input_tokens': 100000, 'output_tokens': 10})
        self.assertEqual(self.catalog.price(row)['rates']['input'], 4)
        row['input'] = 100; self.assertEqual(self.catalog.price(row)['rates']['input'], 2)
        row['model'] = 'gpt-test-super'; self.assertIsNone(self.catalog.price(row)['usd'])
        row['model'] = 'gpt-free'; row['cacheRead'] = 0; self.assertEqual(self.catalog.price(row)['usd'], 0)
        row['cacheRead'] = 5; self.assertEqual(self.catalog.price(row)['status'], 'partial')
        for bad in [True, 'NaN', float('inf'), -1]: self.assertEqual(m.number(bad), 0)
        invalid = m.tokens({'input_tokens': 10, 'cached_input_tokens': 25, 'cache_write_input_tokens': 50}, 'codex')
        self.assertEqual(m.total(invalid), 10)

    def test_local_calendar_filters_timezone_and_no_unknown_account_assignment(self):
        for n, at in enumerate(['2026-09-04T03:00:00Z', '2026-09-20T03:00:00Z', '2026-09-28T03:00:00Z', '2026-10-04T02:59:00Z', '2026-10-04T03:00:00Z']):
            self.index.insert(m.event(str(n), 'codex', 's', at, 'gpt-test', 'openai', {'input_tokens': 100}))
        self.index.db.commit(); now = m.stamp('2026-10-04T12:00:00Z')
        for period, count in [('today', 1), ('7', 3), ('15', 4), ('30', 4), ('all', 5)]:
            report = self.index.report({'agent': 'codex', 'period': period, 'tz': 'America/Argentina/Buenos_Aires'}, self.catalog, now)
            self.assertEqual(report['summary']['requests'], count, period)
        report = self.index.report({'agent': 'codex', 'period': 'today', 'tz': 'UTC'}, self.catalog, now)
        self.assertEqual(report['summary']['requests'], 2)
        self.assertEqual(report['facets']['account'], ['unknown'])
        self.assertEqual(self.index.report({'agent': 'codex', 'period': 'all', 'account': 'selected', 'tz': 'UTC'}, self.catalog, now)['summary']['requests'], 0)
        alias = self.index.report({'agent': 'codex', 'period': 'today', 'tz': 'America/Buenos_Aires'}, self.catalog, now)
        self.assertEqual(alias['summary']['requests'], 1)

    def test_project_attribution_uses_native_cwd_and_never_leaks_neighbour_or_unknown_usage(self):
        at = '2026-10-04T03:00:00Z'
        for n, directory in enumerate(['/home/u/demo', '/home/u/demo/api', '/home/u/demo-other', '']):
            self.index.insert(m.event(str(n), 'codex', 's' + str(n), at, 'gpt-test', 'openai', {'input_tokens': 10}, project=directory))
        self.index.db.commit()
        report = self.index.report({'period': 'all', 'project': '/home/u/demo', 'tz': 'UTC'}, self.catalog, m.stamp('2026-10-04T12:00:00Z'))
        self.assertEqual(report['summary']['requests'], 2)
        self.assertEqual(report['summary']['total'], 20)
        self.assertEqual(self.index.db.execute('select count(*) from events').fetchone()[0], 4)
        state = {'session': 'c', 'account': 'unknown'}
        m.parse_claude({'type': 'user', 'cwd': '/home/u/demo'}, state)
        result = m.parse_claude({'type': 'assistant', 'timestamp': at, 'message': {'id': 'm', 'usage': {'input_tokens': 3}}}, state)
        self.assertEqual(result[0]['project'], '/home/u/demo')

    def test_price_cache_update_failure_retains_original_date_and_private_permissions(self):
        original = self.catalog.meta['fetchedAt']; calls = []
        failed = m.Catalog(self.index.folder, now=original + 90000, fetch=lambda: calls.append(1) or (_ for _ in ()).throw(ValueError()))
        failed.load(); self.assertTrue(failed.meta['stale']); self.assertEqual(failed.meta['fetchedAt'], original)
        failed.load(True); self.assertEqual(len(calls), 1)
        self.assertEqual((self.index.folder / 'prices.json').stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.index.folder / 'index.sqlite').stat().st_mode & 0o777, 0o600)

    def test_subscription_fractional_rates_and_custom_relay_canonical_price(self):
        self.catalog.data['opencode-go/low-cost'] = {'cost': {'input': .15, 'output': .6, 'cache_read': .003}, 'canonical': 'missing-lab/low-cost'}
        hit, key, basis = self.catalog.lookup('opencode-go', 'low-cost')
        self.assertEqual((key, hit['cost']['input']), ('opencode-go/low-cost', .15))
        self.catalog.data['relay/gpt-test'] = {'cost': {'input': 5, 'output': 50}, 'canonical': 'openai/gpt-test'}
        self.assertEqual(self.catalog.lookup('custom-bridge', 'gpt-test')[1], 'openai/gpt-test')
        self.assertIsNone(self.catalog.lookup('custom-bridge', 'gpt-test-fast')[0])

    def test_gemini_snapshots_dedup_and_disjoint_tokens(self):
        record = {'messages': [{'id': 'one', 'type': 'gemini', 'timestamp': '2026-10-04T03:00:00Z', 'model': 'gemini-test', 'tokens': {'input': 100, 'cached': 60, 'output': 10, 'thoughts': 5}}]}
        self.write('.gemini/tmp/project/chats/session-test.jsonl', [record, {'$set': record}]); self.index.refresh()
        row = dict(self.index.db.execute('select * from events').fetchone())
        self.assertEqual((row['input'], row['output'], row['cacheRead'], m.total(row)), (40, 15, 60, 115))

if __name__ == '__main__': unittest.main()

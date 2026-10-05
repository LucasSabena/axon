import asyncio
import base64
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


accounts = module('accounts', 'agent-accounts.py')
desktop = module('desktop', 'codex-server-account.py')


def credential(root, email, ident):
    root.mkdir(parents=True, exist_ok=True)
    claim = base64.urlsafe_b64encode(json.dumps({'email': email}).encode()).decode().rstrip('=')
    (root / 'auth.json').write_text(json.dumps({'tokens': {'account_id': ident, 'id_token': 'x.' + claim + '.x', 'access_token': 'private-access-' + ident, 'refresh_token': 'private-refresh-' + ident}}))


class ServerAccounts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='axon-server-account-')
        self.home = Path(self.temp.name); self.store = accounts.Store(self.home)
        credential(self.home / '.codex', 'personal@example.test', 'personal-account')
        (self.home / '.codex/config.toml').write_text('model = "fixture"\n')
        (self.home / '.codex/sessions').mkdir()
        (self.home / '.codex/sessions/history.jsonl').write_text('preserve history')
        self.original = (self.home / '.codex/auth.json').read_bytes()
        self.source = Path(__file__).with_name('agent-accounts.py').read_text()
        self.server_source = Path(__file__).with_name('codex-server-account.py').read_text()
        self.ident = self.store.change({'agent':'codex','action':'create','label':'Empresa','source':self.source,'serverSource':self.server_source})['createdId']
        credential(self.store.profile_home('codex', self.ident), 'company@example.test', 'company-account')
        self.store.change({'agent':'codex','action':'activate','id':self.ident})
        # No fixture may dispatch a real daemon operation or detached process.
        self.store.schedule_desktop = lambda: None
        self.store.change({'agent':'codex','action':'enable-server'})

    def tearDown(self): self.temp.cleanup()

    def test_enable_preserves_credential_owner_and_desktop_history(self):
        native = self.home / '.codex/auth.json'
        personal = self.store.profile_home('codex', 'current') / 'auth.json'
        self.assertTrue(native.is_symlink()); self.assertEqual(native.resolve(), personal)
        self.assertEqual(personal.read_bytes(), self.original)
        self.assertEqual((self.home / '.codex/config.toml').read_text(), 'model = "fixture"\n')
        self.assertEqual((self.home / '.codex/sessions/history.jsonl').read_text(), 'preserve history')
        self.assertEqual(self.store.listing('codex')['scope'], 'server')
        self.assertNotIn('private-access', json.dumps(self.store.listing('codex')))

    def test_refresh_follows_selected_owner_and_rejects_foreign_auth_link(self):
        self.store.point_server_auth(self.ident)
        native = self.home / '.codex/auth.json'; d = json.loads(native.read_text()); d['tokens']['refresh_token'] = 'renewed'; native.write_text(json.dumps(d))
        self.assertEqual(json.loads((self.store.profile_home('codex', self.ident) / 'auth.json').read_text())['tokens']['refresh_token'], 'renewed')
        self.assertEqual((self.store.profile_home('codex', 'current') / 'auth.json').read_bytes(), self.original)
        native.unlink(); native.symlink_to(self.home / 'foreign')
        with self.assertRaises(accounts.Failure): self.store.point_server_auth('current')

    def test_unqualified_cli_uses_selected_profile_until_desktop_identity_is_verified(self):
        fake = self.home / 'bin'; fake.mkdir(); exe = fake / 'codex'; exe.write_text('#!/bin/sh\n'); exe.chmod(0o700)
        from unittest.mock import patch
        status = self.store.root / 'desktop-status.json'
        with patch.dict(os.environ, {'PATH':str(fake)+':'+os.environ['PATH']}):
            accounts.atomic(status, json.dumps({'state':'error','selectedId':self.ident}))
            pending, pending_env, _ = self.store.invocation('codex',None,[],server_default=True)
            self.assertEqual(pending_env['CODEX_HOME'], str(self.store.profile_home('codex',self.ident)))
            self.assertIn('--no-daemon',pending)
            info, _, _ = self.store.invocation('codex',None,['--version'],server_default=True)
            self.assertIn('--version', info)
            self.store.point_server_auth(self.ident)
            accounts.atomic(status, json.dumps({'state':'ready','selectedId':self.ident,'verified':True}))
            argv, env, _ = self.store.invocation('codex',None,[],server_default=True)
            self.assertEqual(env['CODEX_HOME'], str(self.home / '.codex')); self.assertNotIn('--no-daemon',argv)
            explicit, env, _ = self.store.invocation('codex','current',[])
            self.assertEqual(env['CODEX_HOME'], str(self.store.profile_home('codex','current'))); self.assertIn('--no-daemon',explicit)

    def factory(self, busy):
        outer = self
        class FakeDesktop:
            def __init__(self, home): pass
            async def __aenter__(self): return self
            async def __aexit__(self,*_): pass
            async def account(self):
                d=json.loads((outer.home / '.codex/auth.json').read_text())
                ident=d['tokens']['account_id']; return {'email':ident+'@example.test','accountId':ident}
            async def busy(self): return busy
        return FakeDesktop

    def test_busy_turn_keeps_old_auth_and_never_restarts(self):
        calls = []
        async def restart(): calls.append('restart')
        asyncio.run(desktop.reconcile(self.store, accounts.atomic, once=True, restart=restart, desktop_factory=self.factory(True)))
        state = json.loads((self.store.root / 'desktop-status.json').read_text())
        self.assertEqual(state['state'],'pending'); self.assertFalse(state['verified']); self.assertEqual(calls,[])
        self.assertEqual((self.home / '.codex/auth.json').read_bytes(), self.original)

    def test_idle_switch_requires_identity_readback_before_ready(self):
        calls = []
        async def restart():
            calls.append('stop-and-start'); self.store.point_server_auth(self.ident)
        asyncio.run(desktop.reconcile(self.store, accounts.atomic, once=True, restart=restart, desktop_factory=self.factory(False)))
        state=json.loads((self.store.root / 'desktop-status.json').read_text())
        self.assertEqual(calls,['stop-and-start']);self.assertEqual(state['state'],'ready');self.assertTrue(state['verified'])
        self.assertEqual((self.store.profile_home('codex','current') / 'auth.json').read_bytes(),self.original)

    def test_failed_readback_is_not_reported_as_active(self):
        async def restart(): pass
        asyncio.run(desktop.reconcile(self.store, accounts.atomic, once=True, restart=restart, desktop_factory=self.factory(False)))
        state=json.loads((self.store.root / 'desktop-status.json').read_text())
        self.assertEqual(state['state'],'error');self.assertFalse(state['verified'])

    def test_ssh_adoption_rejects_a_non_codex_peer_without_signalling(self):
        from unittest.mock import patch
        peer = desktop.Desktop(self.home)
        peer.peer_pid = os.getpid()
        peer.peer_fd = os.pidfd_open(peer.peer_pid)
        try:
            with patch.object(desktop.signal, 'pidfd_send_signal') as send:
                with self.assertRaisesRegex(RuntimeError, 'validar el proceso'):
                    asyncio.run(peer.stop_direct_server())
                send.assert_not_called()
            self.assertEqual((self.home / '.codex/auth.json').read_bytes(), self.original)
        finally:
            os.close(peer.peer_fd)


if __name__ == '__main__': unittest.main()

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('manager', Path(__file__).with_name('axon.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class UpgradeContracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='axon-installer-test-')
        self.root = Path(self.temp.name)
        self.old = {'revision': 'a' * 40, 'version': '1.0.0', 'image': 'axon-local:old'}
        self.new = {'revision': 'b' * 40, 'version': '1.1.0', 'image': 'axon-local:new'}
        self.state = {'name': 'axon-test', 'port': 34591, 'bind': '127.0.0.1', 'origin': 'http://localhost:34591', 'hostUser': 'test', 'repository': 'fixture', 'current': self.old, 'previous': None}
        (self.root / 'data').mkdir()
        (self.root / 'data/config.json').write_text('private-original-config')
        (self.root / 'data/library.db').write_bytes(b'original-database')
        (self.root / '.env').write_text('SESSION_SECRET=original-secret\n')
        m.atomic(self.root / 'compose.json', m.manifest(self.root, self.state, self.old))
        m.save_state(self.root, self.state)
        self.commands = []
        self.compose = patch.object(m, 'compose', side_effect=lambda root, file, *args: self.commands.append(args))
        self.compose.start()
        self.backup = patch.object(m, 'backup', return_value='/fixture/backup')
        self.backup.start()

    def tearDown(self):
        self.compose.stop(); self.backup.stop(); self.temp.cleanup()

    def unchanged_data(self):
        self.assertEqual((self.root / 'data/config.json').read_text(), 'private-original-config')
        self.assertEqual((self.root / 'data/library.db').read_bytes(), b'original-database')
        self.assertEqual((self.root / '.env').read_text(), 'SESSION_SECRET=original-secret\n')

    def test_manifest_keeps_data_and_ui_in_same_version(self):
        service = json.loads(m.manifest(self.root, self.state, self.new))['services']['axon']
        self.assertEqual(service['environment']['AXON_BIND_HOST'], '127.0.0.1')
        self.assertEqual(service['environment']['AXON_REVISION'], self.new['revision'])
        # Configuration backups resolve this container's own persistent bind,
        # including custom names and the default axon-managed installation.
        self.assertEqual(service['environment']['AXON_CONTAINER_NAME'], self.state['name'])
        self.assertFalse(any(v['target'] == '/app/public' for v in service['volumes']))
        self.assertTrue(any(v['target'] == '/app/data' and v['source'] == str(self.root / 'data') for v in service['volumes']))

    def test_upgrade_records_old_release_and_preserves_all_data(self):
        with patch.object(m, 'verify'):
            m.activate(self.root, self.state, self.new, None)
        state = m.read_state(self.root)
        self.assertEqual(state['current'], self.new)
        self.assertEqual(state['previous'], self.old)
        self.assertEqual(state['operation'], 'ready')
        self.assertEqual(self.commands[1][0], 'stop')
        self.assertIn('--wait', self.commands[-1])
        self.unchanged_data()

    def test_failed_health_restores_old_manifest_and_release(self):
        with patch.object(m, 'verify', side_effect=[RuntimeError('wrong revision'), None]):
            with self.assertRaises(RuntimeError): m.activate(self.root, self.state, self.new, None)
        state = m.read_state(self.root)
        self.assertEqual(state['current'], self.old)
        self.assertEqual(state['operation'], 'rolled-back')
        service = json.loads((self.root / 'compose.json').read_text())['services']['axon']
        self.assertEqual(service['image'], self.old['image'])
        self.unchanged_data()

    def test_backup_failure_restarts_old_release_before_propagating(self):
        with patch.object(m, 'backup', side_effect=RuntimeError('disk full')), patch.object(m, 'verify'):
            with self.assertRaises(RuntimeError): m.activate(self.root, self.state, self.new, None)
        self.assertEqual(m.read_state(self.root)['operation'], 'rolled-back')
        self.assertEqual(self.commands[-1][0], 'up')
        self.unchanged_data()

    def test_recovery_failure_never_claims_success(self):
        with patch.object(m, 'verify', side_effect=RuntimeError('unhealthy')):
            with self.assertRaises(RuntimeError): m.activate(self.root, self.state, self.new, None)
        self.assertEqual(m.read_state(self.root)['operation'], 'recovery-required')
        self.assertEqual(m.read_state(self.root)['current'], self.old)

    def test_failed_build_does_not_stop_current_application(self):
        with patch.object(m, 'preflight'), patch.object(m, 'check_owner'), patch.object(m, 'checkout', return_value=(self.new, self.root)), patch.object(m, 'build', side_effect=RuntimeError('build failed')):
            with self.assertRaises(RuntimeError): m.update(self.root, 'main')
        self.assertEqual(self.commands, [])
        self.assertEqual(m.read_state(self.root)['current'], self.old)
        self.unchanged_data()

    def test_up_to_date_does_not_rebuild_or_restart(self):
        with patch.object(m, 'preflight'), patch.object(m, 'check_owner'), patch.object(m, 'checkout', return_value=(self.old, self.root)), patch.object(m, 'build') as build:
            m.update(self.root, 'main')
            build.assert_not_called()
        self.assertEqual(self.commands, [])

    def test_lock_prevents_concurrent_upgrades(self):
        with m.lock(self.root):
            with self.assertRaisesRegex(RuntimeError, 'en curso'):
                with m.lock(self.root): pass

    def test_wrong_revision_is_rejected(self):
        from io import BytesIO
        from contextlib import closing
        with patch.object(m.urllib.request, 'urlopen', return_value=closing(BytesIO(json.dumps({'ok': True, 'revision': self.old['revision']}).encode()))):
            with self.assertRaises(RuntimeError): m.verify(self.state, self.new)

    def test_other_installations_cannot_be_taken_over(self):
        from subprocess import CompletedProcess
        with patch.object(m.subprocess, 'run', return_value=CompletedProcess([], 0, stdout='[{"Config":{"Labels":{"io.axon.installation":"/other"}}}]')):
            with self.assertRaisesRegex(RuntimeError, 'otra instalación'): m.check_owner(self.root, 'fixture')


if __name__ == '__main__': unittest.main()

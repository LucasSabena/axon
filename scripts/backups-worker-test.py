"""Real Restic regressions using only temporary, owned repositories."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
import uuid
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('backup_host', Path(__file__).resolve().parents[1] / 'src/platform/backup-host.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class BackupWorkerTests(unittest.TestCase):
    def test_progress_arrives_before_completion_and_ignores_untrusted_fields(self):
        progress = []
        script = 'import json,time; print("not json",flush=True); print("[]",flush=True); print(json.dumps({"message_type":"status","bytes_done":100,"total_bytes":200,"current_files":["private"],"files_done":-1,"error_count":True}),flush=True); time.sleep(.3); print(json.dumps({"message_type":"summary","snapshot_id":"abc"}),flush=True)'
        def report(value):
            # Summary has not arrived yet: report must be called while running.
            self.assertEqual(value.get('bytes_done'), 100)
            progress.append(value)
        code, summary = worker.capture_backup([sys.executable, '-c', script], dict(os.environ), report)
        self.assertEqual((code, summary['snapshot_id']), (0, 'abc'))
        self.assertEqual(progress, [{'bytes_done': 100, 'total_bytes': 200}])

    def test_stalled_capture_is_killed_and_reaped(self):
        before = time.monotonic()
        with self.assertRaisesRegex(RuntimeError, 'tiempo máximo'):
            worker.capture_backup([sys.executable, '-c', 'import time; time.sleep(20)'], dict(os.environ), lambda _: None, timeout=.1)
        self.assertLess(time.monotonic() - before, 2)

    def test_partial_snapshot_is_recoverable_but_never_prunes_or_becomes_complete(self):
        with tempfile.TemporaryDirectory(prefix='axon-partial-test-') as home:
            source = Path(home) / 'source'; source.mkdir(); (source / 'proof.txt').write_text('Original preserved')
            policy = dict(id='partial-fixture', kind='files', source=str(source), sources=[str(source)], exclusions=[], enabled=True, retentionDays=1)
            request = dict(home=home, id=str(uuid.uuid4()), policy=policy)
            base = worker.base_for(request)
            worker.private(base / 'jobs')
            (base / 'launch.lock').touch(mode=0o600)
            target = base / 'jobs' / (request['id'] + '.json')
            worker.atomic(target, dict(id=request['id'], policy=policy, mode='backup', state='queued', createdAt=int(time.time()*1000)))
            capture = worker.capture_backup
            def partial(*args, **kwargs):
                code, summary = capture(*args, **kwargs)
                self.assertEqual(code, 0)
                return 3, summary  # real snapshot, simulated unreadable extra source
            with patch.object(worker, 'capture_backup', partial), patch.object(worker, 'retain_verified') as retain:
                worker.worker(request)
                retain.assert_not_called()
            receipt = worker.read(target)
            self.assertEqual(receipt['state'], 'failed'); self.assertEqual(receipt['phase'], 'partial')
            self.assertTrue(receipt['partial']); self.assertTrue(receipt['snapshot']); self.assertTrue(receipt['verifiedAt'])
            self.assertIn('incompleta', receipt['message']); self.assertEqual(receipt['forgottenSnapshots'], [])
            self.assertEqual((source / 'proof.txt').read_text(), 'Original preserved')
            # Recovery and a later check must preserve the original completeness.
            for mode in ('restore', 'verify'):
                children = []
                popen = worker.subprocess.Popen
                def own_child(*args, **kwargs):
                    child = popen(*args, **kwargs); children.append(child); return child
                with patch.object(worker.subprocess, 'Popen', own_child):
                    launched = worker.main(dict(action='start', home=home, id=str(uuid.uuid4()), mode=mode, originalId=request['id']))
                deadline = time.monotonic() + 30
                while launched['state'] in ('queued', 'running') and time.monotonic() < deadline:
                    time.sleep(.1); launched = worker.main(dict(action='status', home=home, id=launched['id']))
                for child in children: child.wait(timeout=5)
                self.assertTrue(launched['partial'])
                self.assertEqual(launched['state'], 'verified' if mode == 'restore' else 'failed')
                if mode == 'restore':
                    self.assertEqual((Path(launched['restoredPath']) / str(source).lstrip('/') / 'proof.txt').read_text(), 'Original preserved')

if __name__ == '__main__': unittest.main()

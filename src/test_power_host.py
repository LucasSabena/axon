import importlib.util
import json
import pathlib
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('power', pathlib.Path(__file__).with_name('power-host.py'))
power = importlib.util.module_from_spec(spec)
spec.loader.exec_module(power)


def hhmm(total):
    return f'{total // 60:02d}:{total % 60:02d}'


class PowerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        pstate = self.root / 'devices/system/cpu/intel_pstate'
        pstate.mkdir(parents=True)
        (pstate / 'no_turbo').write_text('0')
        (pstate / 'max_perf_pct').write_text('100')
        policy = self.root / 'devices/system/cpu/cpufreq/policy0'
        policy.mkdir(parents=True)
        (policy / 'energy_performance_preference').write_text('balance_performance')
        (policy / 'energy_performance_available_choices').write_text('default performance balance_performance balance_power power')
        rapl = self.root / 'class/powercap/intel-rapl:0'
        rapl.mkdir(parents=True)
        (rapl / 'constraint_0_power_limit_uw').write_text('90000000')
        (rapl / 'constraint_1_power_limit_uw').write_text('115000000')
        self.calls = []
        def command(argv):
            self.calls.append(argv)
            return 0, 'balanced'
        self.fans_calls = []
        self.fans_state = {'ok': True, 'available': True, 'mode': 'auto', 'revision': 0}
        def fans(request):
            self.fans_calls.append(request)
            if request.get('action') == 'set':
                self.fans_state = {**self.fans_state, 'mode': request['mode'], 'revision': self.fans_state['revision'] + 1}
            return dict(self.fans_state)
        self.epoch = time.time()
        self.which = patch.object(power.shutil, 'which', lambda name: '/usr/bin/' + name if name == 'powerprofilesctl' else None)
        self.which.start()
        self.c = power.PowerController(self.root, wallclock=lambda: self.epoch, command=command, fans=fans, state_path=self.root / 'state.json')

    def tearDown(self):
        self.which.stop()
        self.tmp.cleanup()

    def knob(self, name):
        return (self.root / 'devices/system/cpu/intel_pstate' / name).read_text().strip()

    def rapl(self, i):
        return int((self.root / f'class/powercap/intel-rapl:0/constraint_{i}_power_limit_uw').read_text().strip())

    def test_pstate_required(self):
        import shutil as real_shutil
        empty = pathlib.Path(tempfile.mkdtemp())
        with self.assertRaises(RuntimeError):
            power.PowerController(empty, command=lambda a: (0, ''), fans=lambda r: {}, state_path=empty / 's.json')

    def test_quiet_caps_everything_and_lowers_fans(self):
        s = self.c.set({'mode': 'quiet', 'revision': self.c.revision})
        self.assertEqual(self.knob('no_turbo'), '1')
        self.assertEqual(self.knob('max_perf_pct'), '55')
        self.assertEqual(self.rapl(0), 35000000)
        self.assertEqual(self.rapl(1), 50000000)
        self.assertIn(['powerprofilesctl', 'set', 'power-saver'], self.calls)
        self.assertTrue(any(r.get('action') == 'set' and r.get('mode') == 'manual' and r.get('minutes') == 60 for r in self.fans_calls))
        self.assertTrue(self.c.fans_owned)
        self.assertTrue(s['knobs']['quietFans'])

    def test_balanced_restores_platform_defaults_and_releases_fans(self):
        self.c.set({'mode': 'quiet', 'revision': self.c.revision})
        self.c.set({'mode': 'balanced', 'revision': self.c.revision})
        self.assertEqual(self.knob('no_turbo'), '0')
        self.assertEqual(self.knob('max_perf_pct'), '100')
        self.assertEqual(self.rapl(0), 90000000)
        self.assertIn(['powerprofilesctl', 'set', 'balanced'], self.calls)
        self.assertTrue(any(r.get('mode') == 'auto' for r in self.fans_calls if r.get('action') == 'set'))
        self.assertFalse(self.c.fans_owned)

    def test_user_fan_override_is_not_stomped(self):
        self.fans_state['mode'] = 'max'
        self.c.set({'mode': 'quiet', 'revision': self.c.revision})
        self.assertFalse(any(r.get('action') == 'set' for r in self.fans_calls))
        self.assertFalse(self.c.fans_owned)

    def test_schedule_overnight_and_default(self):
        lt = time.localtime(self.epoch)
        now, day = lt.tm_hour * 60 + lt.tm_min, lt.tm_wday
        # Wrap window covering "now": [now-30, now-60) across midnight when it applies.
        schedule = [{'start': hhmm((now - 30) % 1440), 'end': hhmm((now - 60) % 1440), 'mode': 'quiet', 'days': [day]}]
        s = self.c.set({'mode': 'auto', 'schedule': schedule, 'revision': self.c.revision})
        self.assertEqual(self.c.scheduled_mode(self.epoch), 'quiet')
        self.assertEqual(s['source'], 'horario')
        self.assertEqual(s['effectiveMode'], 'quiet')
        if now >= 60:
            self.assertIsNone(self.c.scheduled_mode(self.epoch - 45 * 60))

    def test_schedule_first_match_and_next_change(self):
        lt = time.localtime(self.epoch)
        now, day = lt.tm_hour * 60 + lt.tm_min, lt.tm_wday
        schedule = [
            {'start': hhmm((now + 30) % 1440), 'end': hhmm((now + 90) % 1440), 'mode': 'quiet', 'days': [day]},
            {'start': '00:00', 'end': '23:59', 'mode': 'performance', 'days': [day]},
        ]
        if (now + 90) % 1440 <= now:
            self.skipTest('cruce de medianoche')
        s = self.c.set({'mode': 'auto', 'schedule': schedule, 'revision': self.c.revision})
        # "Todos los minutos" wins only after the quiet window; second entry covers now
        self.assertEqual(self.c.scheduled_mode(self.epoch), 'performance')
        nxt = s['nextChange']
        self.assertIsNotNone(nxt)
        self.assertEqual(nxt['mode'], 'quiet')

    def test_state_persists_across_restart(self):
        self.c.set({'mode': 'quiet', 'schedule': [{'start': '01:00', 'end': '06:00', 'mode': 'quiet'}], 'revision': self.c.revision})
        other = power.PowerController(self.root, wallclock=lambda: self.epoch, command=lambda a: (0, ''), fans=lambda r: {}, state_path=self.root / 'state.json')
        self.assertEqual(other.state['mode'], 'quiet')
        self.assertEqual(len(other.state['schedule']), 1)

    def test_invalid_requests_do_not_write(self):
        before = self.c.status()
        bad = [
            {'mode': 'max', 'revision': self.c.revision},
            {'mode': 'quiet', 'revision': 99},
            {'schedule': [{'start': '23:00', 'end': '23:00', 'mode': 'quiet'}], 'revision': self.c.revision},
            {'schedule': [{'start': '25:00', 'end': '08:00', 'mode': 'quiet'}], 'revision': self.c.revision},
            {'schedule': [{'start': '23:00', 'end': '08:00', 'mode': 'x'}], 'revision': self.c.revision},
            {'schedule': [{'start': '23:00', 'end': '08:00', 'mode': 'quiet', 'days': []}], 'revision': self.c.revision},
            {'schedule': [{'start': '23:00', 'end': '08:00', 'mode': 'quiet', 'days': [7]}], 'revision': self.c.revision},
            {'schedule': [{} for _ in range(11)], 'revision': self.c.revision},
            {'revision': self.c.revision},
        ]
        for req in bad:
            with self.assertRaises(ValueError):
                self.c.set(req)
        self.assertEqual(self.c.status()['revision'], before['revision'])

    def test_failed_apply_reverts_state_and_restores_defaults(self):
        original = pathlib.Path.write_text
        def write(p, value, *args, **kwargs):
            if p.name == 'no_turbo' and value == '1':
                raise OSError('pstate rejected write')
            return original(p, value, *args, **kwargs)
        self.c.set({'mode': 'balanced', 'revision': self.c.revision})
        with patch.object(pathlib.Path, 'write_text', write):
            with self.assertRaises(OSError):
                self.c.set({'mode': 'quiet', 'revision': self.c.revision})
        self.assertEqual(self.c.state['mode'], 'balanced')
        self.assertEqual(self.knob('no_turbo'), '0')
        self.assertEqual(self.knob('max_perf_pct'), '100')


if __name__ == '__main__':
    unittest.main()

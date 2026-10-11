import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('fans', pathlib.Path(__file__).with_name('fans-host.py'))
fans = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fans)

class FansTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        d = self.root / 'class/dmi/id'
        d.mkdir(parents=True)
        for name, value in {'sys_vendor': 'Acer', 'product_name': 'Predator PT315-53', 'bios_version': 'V1.14'}.items():
            (d / name).write_text(value)
        self.h = self.root / 'class/hwmon/hwmon9'
        self.h.mkdir(parents=True)
        for name, value in {'name': 'acer', 'pwm1': '153', 'pwm2': '153', 'pwm1_enable': '2', 'pwm2_enable': '2', 'fan1_input': '2400', 'fan2_input': '2300', 'temp1_input': '50000', 'temp3_input': '45000'}.items():
            (self.h / name).write_text(value)
        self.now = 0
        self.c = fans.FanController(self.root, lambda: self.now)
    def tearDown(self):
        self.tmp.cleanup()
    def manual(self, cpu=60, gpu=70):
        return self.c.set({'mode': 'manual', 'cpu': cpu, 'gpu': gpu, 'minutes': 15, 'revision': self.c.revision})
    def test_exact_model_and_bios_only(self):
        for field, value in [('product_name', 'Predator PH315-53'), ('bios_version', 'V1.15')]:
            p = self.root / 'class/dmi/id' / field
            old = p.read_text()
            p.write_text(value)
            with self.assertRaises(RuntimeError):
                fans.FanController(self.root)
            p.write_text(old)
    def test_manual_independent_percentages_and_restore(self):
        s = self.manual()
        self.assertEqual(s['mode'], 'manual')
        self.assertEqual(self.c.value('pwm1_enable'), 1)
        self.assertEqual(self.c.value('pwm2_enable'), 1)
        self.assertEqual(self.c.value('pwm1'), 153)
        self.assertEqual(self.c.value('pwm2'), 179)
        self.c.set({'mode': 'auto', 'revision': self.c.revision})
        self.assertEqual(self.c.value('pwm1_enable'), 2)
        self.assertEqual(self.c.value('pwm2_enable'), 2)
    def test_hot_temperature_and_hysteresis(self):
        self.manual()
        (self.h / 'temp3_input').write_text('81000')
        self.c.tick()
        self.assertEqual(self.c.status()['effectiveMode'], 'max')
        self.assertEqual(self.c.value('pwm1_enable'), 0)
        self.assertEqual(self.c.value('pwm2_enable'), 0)
        (self.h / 'temp3_input').write_text('75000')
        self.c.tick()
        self.assertEqual(self.c.status()['effectiveMode'], 'max')
        (self.h / 'temp3_input').write_text('65000')
        self.c.tick()
        self.assertEqual(self.c.status()['effectiveMode'], 'manual')
    def test_missing_or_implausible_telemetry_never_runs_low(self):
        for value in ('0', '130000', 'invalid'):
            (self.h / 'temp1_input').write_text(value)
            self.manual()
            self.assertEqual(self.c.value('pwm1_enable'), 0)
            self.assertTrue(self.c.override)
        (self.h / 'temp1_input').unlink()
        self.c.tick()
        self.assertEqual(self.c.value('pwm2_enable'), 0)
    def test_expired_lease_returns_both_to_auto(self):
        self.manual()
        self.now = 901
        self.c.tick()
        self.assertEqual(self.c.status()['mode'], 'auto')
        self.assertEqual(self.c.value('pwm1_enable'), 2)
        self.assertEqual(self.c.value('pwm2_enable'), 2)
    def test_stale_revision_and_invalid_requests_do_not_write(self):
        self.manual()
        before = self.c.status()
        for req in [{'mode':'max','revision':0}, {'mode':'manual','cpu':0,'gpu':70,'revision':self.c.revision}, {'mode':'manual','cpu':True,'gpu':70,'revision':self.c.revision}, {'mode':'manual','cpu':60,'gpu':70,'minutes':100,'revision':self.c.revision}, {'mode':'other','revision':self.c.revision}]:
            with self.assertRaises(ValueError):
                self.c.set(req)
        self.assertEqual(self.c.status(), before)
    def test_partial_hardware_failure_restores_both_channels(self):
        original = pathlib.Path.write_text
        def write(p, value, *args, **kwargs):
            if p.name == 'pwm2_enable' and value == '1':
                raise OSError('GPU rejected write')
            return original(p, value, *args, **kwargs)
        with patch.object(pathlib.Path, 'write_text', write):
            with self.assertRaises(OSError):
                self.manual()
        self.assertEqual(self.c.value('pwm1_enable'), 2)
        self.assertEqual(self.c.value('pwm2_enable'), 2)
        self.assertEqual(self.c.desired['mode'], 'auto')
    def test_external_mode_change_cannot_defeat_thermal_override(self):
        (self.h / 'temp1_input').write_text('90000')
        self.manual()
        (self.h / 'pwm1_enable').write_text('1')
        self.c.tick()
        self.assertEqual(self.c.value('pwm1_enable'), 0)

if __name__ == '__main__':
    unittest.main()

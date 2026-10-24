#!/usr/bin/env python3
"""Intel power and thermal mode adapter with quiet-mode schedules.
Only signed kernel interfaces are touched: intel_pstate sysfs, RAPL powercap
and cpufreq EPP — delegated to power-profiles-daemon over D-Bus while it runs.
Quiet mode may also lower Acer fan speeds through the axon-fans socket, whose
own thermal watchdog stays in charge. No raw EC, ports or overclocking.
"""
import json
import os
import pathlib
import selectors
import shutil
import signal
import socket
import struct
import subprocess
import sys
import time

SOCKET = '/run/axon-power/control.sock'
FANS_SOCKET = '/run/axon-fans/control.sock'
STATE_PATH = os.environ.get('AXON_POWER_STATE', '/var/lib/axon-power/state.json')
MODES = ('performance', 'balanced', 'quiet')
SCHEDULE_MAX = 10
# Quiet caps: turbo off and 55% of the frequency range cut most of the boost
# heat; the 35/50 W RAPL budget keeps sustained load well under the 90/115 W
# platform defaults. GPU clock lock and low fans are best effort.
PROFILES = {
    'performance': {'turbo': True, 'maxPerf': 100, 'profile': 'performance', 'epp': 'performance', 'rapl': None, 'gpuClock': None, 'fan': None},
    'balanced': {'turbo': True, 'maxPerf': 100, 'profile': 'balanced', 'epp': 'balance_performance', 'rapl': None, 'gpuClock': None, 'fan': None},
    'quiet': {'turbo': False, 'maxPerf': 55, 'profile': 'power-saver', 'epp': 'power', 'rapl': (35000000, 50000000), 'gpuClock': '210,600', 'fan': {'cpu': 30, 'gpu': 30}},
}
MODE_NAMES = {'performance': 'Rendimiento', 'balanced': 'Equilibrado', 'quiet': 'Silencioso'}


def parse_time(value):
    if not isinstance(value, str) or len(value) != 5 or value[2] != ':':
        raise ValueError('Horario inválido')
    hours, minutes = value.split(':')
    if not (hours.isdigit() and minutes.isdigit()):
        raise ValueError('Horario inválido')
    total = int(hours) * 60 + int(minutes)
    if not 0 <= total < 1440:
        raise ValueError('Horario inválido')
    return total


def default_command(argv):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=10)
    return result.returncode, result.stdout.strip()


def default_fans(request):
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(5)
        connection.connect(FANS_SOCKET)
        connection.sendall(json.dumps(request).encode() + b'\n')
        raw = b''
        while b'\n' not in raw and len(raw) < 16384:
            part = connection.recv(16384)
            if not part:
                break
            raw += part
        return json.loads(raw)


class PowerController:
    def __init__(self, root='/sys', clock=time.monotonic, wallclock=time.time, command=default_command, fans=default_fans, state_path=STATE_PATH):
        self.root, self.clock, self.wallclock = pathlib.Path(root), clock, wallclock
        self.command, self.fans = command, fans
        self.state_path = pathlib.Path(state_path)
        self.revision = 0
        self.applied = None
        self.fans_owned = False
        self.gpu_locked = False
        self.gpu_error = ''
        self.pstate = self.root / 'devices/system/cpu/intel_pstate'
        if not (self.pstate / 'no_turbo').exists() or not (self.pstate / 'max_perf_pct').exists():
            raise RuntimeError('Este equipo no expone intel_pstate; los modos de energía no están disponibles.')
        self.policies = sorted(self.root.glob('devices/system/cpu/cpufreq/policy*/energy_performance_preference'))
        rapl = self.root / 'class/powercap/intel-rapl:0'
        self.rapl = [rapl / 'constraint_0_power_limit_uw', rapl / 'constraint_1_power_limit_uw']
        if not all(p.exists() for p in self.rapl):
            self.rapl = []
        self.ppd = bool(shutil.which('powerprofilesctl'))
        self.nvidia = bool(shutil.which('nvidia-smi'))
        self.gpu_power = None
        for dev in self.root.glob('bus/pci/devices/*'):
            try:
                if (dev / 'class').read_text().strip() == '0x030000' and (dev / 'vendor').read_text().strip() == '0x10de':
                    self.gpu_power = dev / 'power_state'
                    break
            except OSError:
                continue
        self.state = {'mode': 'auto', 'schedule': [], 'raplDefaults': self._rapl_read()}
        self._load()

    def _rapl_read(self):
        try:
            return [int(p.read_text().strip()) for p in self.rapl] if self.rapl else None
        except (OSError, ValueError):
            return None

    def _load(self):
        try:
            saved = json.loads(self.state_path.read_text())
            if saved.get('mode') in ('auto',) + MODES:
                self.state['mode'] = saved['mode']
            self.state['schedule'] = [self._entry(e) for e in saved.get('schedule', [])][:SCHEDULE_MAX]
            if self.state['raplDefaults'] is None and isinstance(saved.get('raplDefaults'), list):
                self.state['raplDefaults'] = saved['raplDefaults']
        except (OSError, ValueError, KeyError):
            pass

    def _save(self):
        try:
            self.state_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            tmp = self.state_path.with_suffix('.tmp')
            tmp.write_text(json.dumps(self.state))
            os.chmod(tmp, 0o600)
            tmp.replace(self.state_path)
        except OSError as e:
            print('No se pudo guardar el estado: ' + str(e), file=sys.stderr, flush=True)

    def _entry(self, e):
        if not isinstance(e, dict):
            raise ValueError('Horario inválido')
        start, end = parse_time(e.get('start')), parse_time(e.get('end'))
        if start == end:
            raise ValueError('El inicio y el fin no pueden coincidir.')
        if e.get('mode') not in MODES:
            raise ValueError('Modo de horario inválido')
        days = e.get('days', list(range(7)))
        if not isinstance(days, list) or not days or any(type(d) is not int or not 0 <= d <= 6 for d in days):
            raise ValueError('Días inválidos')
        return {'start': e['start'], 'end': e['end'], 'mode': e['mode'], 'days': sorted(set(days))}

    def scheduled_mode(self, epoch):
        t = time.localtime(epoch)
        minute, day = t.tm_hour * 60 + t.tm_min, t.tm_wday
        for e in self.state['schedule']:
            start, end = parse_time(e['start']), parse_time(e['end'])
            if day not in e['days']:
                continue
            inside = start <= minute < end if start < end else minute >= start or minute < end
            if inside:
                return e['mode']
        return None

    def next_change(self, epoch, current):
        for m in range(1, 8 * 24 * 60 + 1):
            mode = self.scheduled_mode(epoch + m * 60)
            if mode != current:
                return {'inMinutes': m, 'mode': mode or 'balanced', 'modeName': MODE_NAMES[mode or 'balanced']}
        return None

    def effective(self):
        if self.state['mode'] != 'auto':
            return self.state['mode'], 'manual'
        scheduled = self.scheduled_mode(self.wallclock())
        return (scheduled, 'horario') if scheduled else ('balanced', 'predeterminado')

    def _write(self, path, value):
        path.write_text(str(value))
        if path.read_text().strip() != str(value):
            raise RuntimeError(f'El kernel no confirmó {path.name}')

    def _apply(self, mode):
        profile = PROFILES[mode]
        try:
            self._write(self.pstate / 'no_turbo', '0' if profile['turbo'] else '1')
            self._write(self.pstate / 'max_perf_pct', profile['maxPerf'])
            if self.ppd:
                code, out = self.command(['powerprofilesctl', 'set', profile['profile']])
                if code != 0:
                    raise RuntimeError('power-profiles-daemon rechazó el perfil: ' + out)
            elif self.policies:
                for p in self.policies:
                    choices = p.with_name('energy_performance_available_choices').read_text().split() if p.with_name('energy_performance_available_choices').exists() else []
                    if not choices or profile['epp'] in choices:
                        self._write(p, profile['epp'])
            if self.rapl:
                defaults = self.state['raplDefaults'] or self._rapl_read()
                targets = profile['rapl'] or defaults
                if targets:
                    for path, watts, fallback in zip(self.rapl, targets, defaults or targets):
                        self._write(path, min(watts, fallback))
        except Exception:
            self._defaults()
            raise
        self.gpu_error = ''
        if self.nvidia:
            # El modo persistente mantiene la GPU inicializada y bloquea el
            # suspend RTD3; apagarlo es idempotente y mejor esfuerzo.
            self.command(['nvidia-smi', '-pm', '0'])
            if profile['gpuClock']:
                code, out = self.command(['nvidia-smi', '-lgc', profile['gpuClock']])
                self.gpu_locked = code == 0
                if code != 0:
                    self.gpu_error = out or 'nvidia-smi rechazó el límite de reloj'
            elif self.gpu_locked:
                code, _ = self.command(['nvidia-smi', '-rgc'])
                self.gpu_locked = code != 0

    def _defaults(self):
        try:
            self._write(self.pstate / 'no_turbo', '0')
            self._write(self.pstate / 'max_perf_pct', '100')
            if self.ppd:
                self.command(['powerprofilesctl', 'set', 'balanced'])
            elif self.policies:
                for p in self.policies:
                    self._write(p, 'balance_performance')
            if self.rapl and self.state['raplDefaults']:
                for path, watts in zip(self.rapl, self.state['raplDefaults']):
                    self._write(path, watts)
            if self.nvidia and self.gpu_locked:
                self.command(['nvidia-smi', '-rgc'])
                self.gpu_locked = False
        except Exception as e:
            print('No se pudieron restaurar los valores predeterminados: ' + str(e), file=sys.stderr, flush=True)

    def _fans_step(self, mode):
        target = PROFILES[mode]['fan']
        try:
            if not target:
                if self.fans_owned:
                    status = self.fans({'action': 'status'})
                    if status.get('ok'):
                        self.fans({'action': 'set', 'mode': 'auto', 'revision': status['revision']})
                    self.fans_owned = False
                return
            status = self.fans({'action': 'status'})
            if not status.get('ok') or not status.get('available'):
                return
            # El modo manual o máximo elegido por el usuario siempre gana.
            if status.get('mode') in ('manual', 'max') and not self.fans_owned:
                return
            if status.get('mode') == 'max':
                self.fans_owned = False
                return
            result = self.fans({'action': 'set', 'mode': 'manual', 'cpu': target['cpu'], 'gpu': target['gpu'], 'minutes': 60, 'revision': status['revision']})
            self.fans_owned = bool(result.get('ok'))
        except Exception:
            pass

    def restore(self):
        self._defaults()
        self._fans_step('balanced')

    def set(self, request):
        if type(request.get('revision')) is not int or request.get('revision') != self.revision:
            raise ValueError('El estado cambió. Actualizá antes de aplicar otro modo.')
        mode = request.get('mode')
        if mode is not None and mode not in ('auto',) + MODES:
            raise ValueError('Modo inválido')
        schedule = request.get('schedule')
        if schedule is not None:
            if not isinstance(schedule, list) or len(schedule) > SCHEDULE_MAX:
                raise ValueError(f'Elegí hasta {SCHEDULE_MAX} horarios.')
            schedule = [self._entry(e) for e in schedule]
        if mode is None and schedule is None:
            raise ValueError('Solicitud vacía')
        previous = dict(self.state)
        if mode is not None:
            self.state['mode'] = mode
        if schedule is not None:
            self.state['schedule'] = schedule
        try:
            self.tick(force=True)
        except Exception:
            self.state = previous
            self._save()
            try:
                self.tick(force=True)
            except Exception:
                pass
            raise
        self._save()
        self.revision += 1
        return self.status()

    def tick(self, force=False):
        mode, source = self.effective()
        signature = (mode, self.ppd, self.nvidia, bool(self.rapl))
        if force or signature != self.applied:
            self._apply(mode)
            self.applied = signature
        else:
            # Reafirmar como la guardia de ventiladores: un cambio externo no
            # debe dejar el equipo fuera del modo elegido.
            try:
                if int((self.pstate / 'no_turbo').read_text().strip()) != (0 if PROFILES[mode]['turbo'] else 1):
                    self._apply(mode)
            except (OSError, ValueError):
                pass
        self._fans_step(mode)

    def status(self):
        mode, source = self.effective()
        scheduled = self.scheduled_mode(self.wallclock())
        turbo = max_perf = epp = None
        try:
            turbo = not int((self.pstate / 'no_turbo').read_text().strip())
            max_perf = int((self.pstate / 'max_perf_pct').read_text().strip())
        except (OSError, ValueError):
            pass
        try:
            epp = self.policies[0].read_text().strip() if self.policies else None
        except OSError:
            pass
        rapl = self._rapl_read()
        profile = None
        if self.ppd:
            try:
                code, out = self.command(['powerprofilesctl', 'get'])
                profile = out if code == 0 else None
            except Exception:
                pass
        return {'ok': True, 'available': True,
                'model': self._text('class/dmi/id/product_name'), 'revision': self.revision,
                'mode': self.state['mode'], 'effectiveMode': mode, 'source': source,
                'modeName': MODE_NAMES[mode], 'schedule': self.state['schedule'],
                'nextChange': self.next_change(self.wallclock(), scheduled) if self.state['mode'] == 'auto' else None,
                'knobs': {'turbo': turbo, 'maxPerfPct': max_perf, 'profile': profile, 'epp': epp,
                          'raplPl1Watts': rapl[0] / 1000000 if rapl else None,
                          'raplPl2Watts': rapl[1] / 1000000 if rapl else None,
                          'gpuClock': 'limitado' if self.gpu_locked else None, 'gpuError': self.gpu_error or None,
                          'gpuPowerState': self.gpu_power.read_text().strip() if self.gpu_power and self.gpu_power.exists() else None,
                          'quietFans': bool(PROFILES[mode]['fan'] and self.fans_owned)},
                'capabilities': {'rapl': bool(self.rapl and self.state['raplDefaults']), 'gpu': self.nvidia,
                                 'fans': os.path.exists(FANS_SOCKET),
                                 'profile': 'power-profiles-daemon' if self.ppd else ('epp' if self.policies else None)},
                'limits': {'modes': list(MODES), 'scheduleMax': SCHEDULE_MAX, 'quietMaxPerfPct': PROFILES['quiet']['maxPerf'],
                           'raplDefaults': [w / 1000000 for w in self.state['raplDefaults']] if self.state['raplDefaults'] else None}}

    def _text(self, p):
        try:
            return (self.root / p).read_text().strip()
        except OSError:
            return ''


def serve():
    controller = PowerController()
    parent = pathlib.Path(SOCKET).parent
    parent.mkdir(mode=0o700, exist_ok=True)
    os.chmod(parent, 0o700)
    pathlib.Path(SOCKET).unlink(missing_ok=True)
    listener = socket.socket(socket.AF_UNIX)
    listener.bind(SOCKET)
    os.chmod(SOCKET, 0o600)
    listener.listen(8)
    listener.setblocking(False)
    selector = selectors.DefaultSelector()
    selector.register(listener, selectors.EVENT_READ)
    running = True
    def stop(*_):
        nonlocal running
        running = False
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        while running:
            try:
                controller.tick()
            except Exception as e:
                print('Modos de energía: ' + str(e), file=sys.stderr, flush=True)
            for _, _ in selector.select(timeout=30):
                connection, _ = listener.accept()
                with connection:
                    connection.settimeout(1)
                    pid, uid, gid = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
                    if uid != 0:
                        continue
                    try:
                        raw = b''
                        while b'\n' not in raw and len(raw) <= 4096:
                            part = connection.recv(4096 - len(raw) + 1)
                            if not part:
                                break
                            raw += part
                        if len(raw) > 4096 or not raw.endswith(b'\n'):
                            raise ValueError('Solicitud inválida')
                        request = json.loads(raw)
                        if not isinstance(request, dict):
                            raise ValueError('Solicitud inválida')
                        if request.get('action') == 'status':
                            result = controller.status()
                        elif request.get('action') == 'set':
                            result = controller.set(request)
                        else:
                            raise ValueError('Acción inválida')
                    except Exception as e:
                        result = {'ok': False, 'error': str(e)}
                    try:
                        connection.sendall(json.dumps(result).encode() + b'\n')
                    except OSError:
                        pass
    finally:
        controller.restore()
        listener.close()
        pathlib.Path(SOCKET).unlink(missing_ok=True)


def client(request):
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(5)
        connection.connect(SOCKET)
        connection.sendall(json.dumps(request).encode() + b'\n')
        raw = b''
        while b'\n' not in raw and len(raw) < 16384:
            part = connection.recv(16384)
            if not part:
                break
            raw += part
        return json.loads(raw)

if __name__ == '__main__':
    try:
        if len(sys.argv) > 1 and sys.argv[1] == 'serve':
            serve()
        elif len(sys.argv) > 1 and sys.argv[1] == 'restore':
            PowerController().restore()
        else:
            request = json.load(sys.stdin)
            try:
                result = client(request)
            except (FileNotFoundError, ConnectionRefusedError, PermissionError, socket.timeout):
                result = {'ok': request.get('action') == 'status', 'available': False,
                          'model': pathlib.Path('/sys/class/dmi/id/product_name').read_text().strip(),
                          'error': 'El servicio de energía no está disponible. Comprobá axon-power.service en el host.'}
            print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)}))
        sys.exit(1)

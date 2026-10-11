#!/usr/bin/env python3
"""Acer PT315-53 native hwmon adapter and independent thermal watchdog.
Only the signed acer_wmi driver touches WMI. No raw EC, ports or overclocking.
"""
import glob
import json
import os
import pathlib
import selectors
import signal
import socket
import struct
import sys
import time

SOCKET = '/run/axon-fans/control.sock'
CPU_LIMIT, GPU_LIMIT = 85, 80
CPU_RESUME, GPU_RESUME = 75, 70

class FanController:
    def __init__(self, root='/sys', clock=time.monotonic):
        self.root, self.clock = pathlib.Path(root), clock
        self.desired = {'mode': 'auto', 'cpu': 100, 'gpu': 100}
        self.until = 0
        self.override = ''
        self.reason = ''
        self.revision = 0
        self.hwmon = None
        if self.read('class/dmi/id/sys_vendor') != 'Acer' or self.read('class/dmi/id/product_name') != 'Predator PT315-53':
            raise RuntimeError('Este controlador sólo admite Acer Predator PT315-53.')
        if self.read('class/dmi/id/bios_version') != 'V1.14':
            raise RuntimeError('Este BIOS todavía no fue validado; requiere comprobar el protocolo antes de habilitar control.')
        for p in (self.root / 'class/hwmon').glob('hwmon*'):
            if (p / 'name').read_text().strip() == 'acer' and all((p / n).exists() for n in ('pwm1', 'pwm2', 'pwm1_enable', 'pwm2_enable', 'fan1_input', 'fan2_input', 'temp1_input', 'temp3_input')):
                self.hwmon = p
                break
        if not self.hwmon:
            raise RuntimeError('El controlador acer_wmi no expone los ventiladores. Instalá el servicio del host de AXON.')

    def read(self, p):
        return (self.root / p).read_text().strip()

    def value(self, p):
        return int((self.hwmon / p).read_text().strip())

    def temperatures(self):
        cpu, gpu = self.value('temp1_input') / 1000, self.value('temp3_input') / 1000
        # A frozen or impossible sensor must never allow a low manual speed.
        if not 5 <= cpu <= 120 or not 5 <= gpu <= 120:
            raise RuntimeError('Temperaturas inválidas')
        return cpu, gpu

    def restore(self):
        errors = []
        for i in (1, 2):
            try:
                (self.hwmon / f'pwm{i}_enable').write_text('2')
                if self.value(f'pwm{i}_enable') != 2:
                    raise RuntimeError('El firmware no confirmó el modo automático')
            except Exception as e:
                errors.append(str(e))
        if errors:
            raise RuntimeError('; '.join(errors))

    def apply(self, mode, cpu=100, gpu=100):
        try:
            if mode == 'auto':
                self.restore()
                return
            for i, speed in ((1, cpu), (2, gpu)):
                if mode == 'manual':
                    # Kernel maps 0..255 to a percent using integer division.
                    # Round up so the requested percentage is exact on readback.
                    (self.hwmon / f'pwm{i}').write_text(str((speed * 255 + 99) // 100))
                (self.hwmon / f'pwm{i}_enable').write_text('0' if mode == 'max' else '1')
                if self.value(f'pwm{i}_enable') != (0 if mode == 'max' else 1):
                    raise RuntimeError('El firmware no confirmó el modo solicitado')
                if mode == 'manual' and abs(round(self.value(f'pwm{i}') * 100 / 255) - speed) > 1:
                    raise RuntimeError('El firmware no confirmó la potencia solicitada')
        except Exception:
            self.desired = {'mode': 'auto', 'cpu': 100, 'gpu': 100}
            self.until = 0
            self.revision += 1
            self.restore()
            raise

    def set(self, request):
        if type(request.get('revision')) is not int or request.get('revision') != self.revision:
            raise ValueError('El estado cambió. Actualizá antes de aplicar otra velocidad.')
        mode = request.get('mode')
        if mode not in ('auto', 'max', 'manual'):
            raise ValueError('Modo inválido')
        cpu, gpu = request.get('cpu', 100), request.get('gpu', 100)
        minutes = request.get('minutes', 15)
        if mode == 'manual':
            if any(type(v) is not int or not 20 <= v <= 100 for v in (cpu, gpu)):
                raise ValueError('La potencia manual debe estar entre 20 y 100%.')
            if type(minutes) is not int or minutes not in (15, 30, 60):
                raise ValueError('Elegí 15, 30 o 60 minutos de control manual.')
        if mode != 'manual':
            cpu = gpu = 100
        self.desired = {'mode': mode, 'cpu': cpu, 'gpu': gpu}
        self.until = self.clock() + minutes * 60 if mode == 'manual' else 0
        self.reason = ''
        # If telemetry is missing or hot, enter maximum before acknowledging.
        self.override = ''
        self.tick(force=True)
        self.revision += 1
        return self.status()

    def tick(self, force=False):
        mode = self.desired['mode']
        if mode == 'manual' and self.clock() >= self.until:
            self.desired['mode'] = mode = 'auto'
            self.until = 0
            self.reason = 'Terminó el período manual; el BIOS vuelve a regular los ventiladores.'
            self.revision += 1
            force = True
        override = self.override
        if mode == 'manual':
            try:
                cpu, gpu = self.temperatures()
                if cpu >= CPU_LIMIT or gpu >= GPU_LIMIT:
                    override = 'Temperatura alta: ventiladores al máximo.'
                elif override and cpu < CPU_RESUME and gpu < GPU_RESUME:
                    override = ''
            except Exception:
                override = 'Sin lectura térmica fiable: ventiladores al máximo.'
        else:
            override = ''
        if force or override != self.override:
            self.apply('max' if override else mode, self.desired['cpu'], self.desired['gpu'])
            if override != self.override:
                self.revision += 1
            self.override = override
        # Enforce the safety override if firmware/hotkey changed it externally.
        for i in (1, 2):
            expected = 0 if override or mode == 'max' else 1 if mode == 'manual' else 2
            if self.value(f'pwm{i}_enable') != expected:
                self.apply('max' if override else mode, self.desired['cpu'], self.desired['gpu'])
                break

    def status(self):
        def optional(p):
            try:
                return self.value(p)
            except (OSError, ValueError):
                return None
        return {'ok': True, 'available': True, 'model': 'Acer Predator PT315-53', 'bios': 'V1.14',
                'backend': 'acer_wmi', 'revision': self.revision, 'mode': self.desired['mode'],
                'effectiveMode': 'max' if self.override else self.desired['mode'],
                'cpu': self.desired['cpu'], 'gpu': self.desired['gpu'],
                'cpuRpm': optional('fan1_input'), 'gpuRpm': optional('fan2_input'),
                'cpuTemp': (optional('temp1_input') or 0) / 1000 or None,
                'gpuTemp': (optional('temp3_input') or 0) / 1000 or None,
                'remainingSeconds': max(0, int(self.until - self.clock())) if self.until else None,
                'override': self.override, 'reason': self.reason,
                'limits': {'minPercent': 20, 'cpuMaxTemp': CPU_LIMIT, 'gpuMaxTemp': GPU_LIMIT}}


def serve():
    controller = FanController()
    controller.restore()  # normalize initial firmware mode, including its unknown boot state
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
                print('Watchdog: ' + str(e), file=sys.stderr, flush=True)
                # A failed hardware write is a service failure: ExecStopPost
                # independently retries AUTO and systemd restarts the guard.
                raise
            for _, _ in selector.select(timeout=1):
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
            FanController().restore()
        else:
            request = json.load(sys.stdin)
            try:
                result = client(request)
            except (FileNotFoundError, ConnectionRefusedError, PermissionError, socket.timeout):
                result = {'ok': request.get('action') == 'status', 'available': False,
                          'model': pathlib.Path('/sys/class/dmi/id/product_name').read_text().strip(),
                          'error': 'El servicio de ventiladores no está disponible. Comprobá axon-fans.service en el host.'}
            print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)}))
        sys.exit(1)

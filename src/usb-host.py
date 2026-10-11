#!/usr/bin/env python3
"""USB port inventory and reversible port leases, independent of AXON/browser.

Uses the documented Linux port/disable ABI. It never claims VBUS was removed.
The lease journal survives a daemon crash; startup and ExecStopPost restore it.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import socketserver
import struct
import sys
import threading
import time

SOCKET = '/run/axon-usb/control.sock'
JOURNAL = '/var/lib/axon-usb/leases.json'

def read(p, default=''):
    try:
        return p.read_text().strip()
    except OSError:
        return default

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()

class UsbController:
    def __init__(self, root='/sys', journal=JOURNAL, proc='/proc', dev='/dev', clock=time.monotonic):
        self.root, self.journal, self.proc, self.dev = map(Path, (root, journal, proc, dev))
        self.clock = clock
        self.lock = threading.RLock()
        self.job = None
        self.leases = json.loads(read(self.journal, '{}'))

    def save(self):
        self.journal.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temp = self.journal.with_suffix('.tmp')
        with open(temp, 'w') as f:
            os.chmod(temp, 0o600)
            json.dump(self.leases, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, self.journal)
        fd = os.open(self.journal.parent, os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def raw_ports(self):
        base = self.root / 'bus/usb/devices'
        paths = list(base.glob('*:*/*-port*')) + list(base.glob('*/*:*/*-port*'))
        return {p.name: p.resolve() for p in paths if (p / 'disable').exists()}

    def identity(self, p):
        hub = p.parent.parent
        # USB descriptor attributes take the hub mutex. A failing enumeration
        # can hold it for many seconds. Kernel object inodes identify a replaced
        # hub without waiting on USB transactions or the failing port.
        return digest([str(p.resolve()), hub.stat().st_ino, p.stat().st_ino,
                       read(self.proc / 'sys/kernel/random/boot_id')])

    def devices(self, paths):
        roots = []
        for p in paths:
            hub, port = p.name.rsplit('-port', 1)
            roots.append(hub[3:] + '-' + port if hub.startswith('usb') else hub + '.' + port)
        result = []
        for p in (self.root / 'bus/usb/devices').iterdir():
            if ':' in p.name or not any(p.name == r or p.name.startswith(r + '.') for r in roots):
                continue
            classes = sorted(set(read(i / 'bInterfaceClass') for i in p.glob('*:*')))
            result.append({'id': p.name, 'name': read(p / 'product') or 'Dispositivo USB',
                           'vendor': read(p / 'idVendor'), 'product': read(p / 'idProduct'),
                           'serial': read(p / 'serial'), 'speed': read(p / 'speed'),
                           'classes': classes, 'path': str(p.resolve()), 'identity': p.stat().st_ino})
        return sorted(result, key=lambda d: d['id'])

    def disks(self, devices):
        result = []
        mounts = {line.split()[2] for line in read(self.proc / 'self/mountinfo').splitlines() if len(line.split()) > 3}
        swaps = {line.split()[0] for line in read(self.proc / 'swaps').splitlines()[1:] if line.split()}
        for b in (self.root / 'class/block').iterdir():
            if not any(str(b.resolve()).startswith(d['path'] + '/') for d in devices):
                continue
            result.append({'name': b.name, 'number': read(b / 'dev'), 'mounted': read(b / 'dev') in mounts,
                           'partition': (b / 'partition').exists(), 'swap': str(self.dev / b.name) in swaps,
                           'model': read(b / 'device/model'),
                           'labels': [re.sub(r'\\x([0-9a-fA-F]{2})', lambda m: chr(int(m[1], 16)), l.name) for l in (self.dev / 'disk/by-label').glob('*') if l.resolve().name == b.name],
                           'holders': [p.name for p in (b / 'holders').glob('*')]})
        return sorted(result, key=lambda b: b['name'])

    def inventory(self):
        raw = self.raw_ports()
        seen, ports = set(), []
        for name, p in sorted(raw.items()):
            if name in seen:
                continue
            peer = (p / 'peer').resolve().name if (p / 'peer').exists() else ''
            names = sorted(set([name] + ([peer] if peer in raw else [])))
            # This Acer's USB-C HS/SS channels are on different PCI controllers.
            # Firmware assigns the same nonzero physical location to both;
            # Linux does not create a peer link between those controllers.
            location = read(p / 'location')
            if read(self.root / 'class/dmi/id/product_name') == 'Predator PT315-53' and read(self.root / 'class/dmi/id/bios_version') == 'V1.14' and location not in ('', '0', '0x0', '0x00000000') and read(p / 'connect_type') == 'hotplug':
                names = sorted(set(names + [n for n, q in raw.items() if q.parent.parent.name.startswith('usb') and read(q / 'connect_type') == 'hotplug' and read(q / 'location') == location]))
            paths = [raw[n] for n in names]
            seen.update(names)
            devices = self.devices(paths)
            disks = self.disks(devices)
            types = [read(q / 'connect_type', 'unknown') for q in paths]
            reason = ''
            if any(t not in ('hotplug',) for t in types):
                reason = 'Puerto interno, no utilizado o sin ubicación externa confirmada.'
            elif any(b['mounted'] or b['swap'] or b['holders'] for b in disks):
                reason = 'Tiene un disco montado, swap o almacenamiento en uso. Desmontalo desde Discos antes de reconectar.'
            elif any(set(d['classes']) - {'08', '09', '01', '07'} for d in devices):
                reason = 'Contiene interfaces de red, entrada o una función que requiere revisión antes de desconectarla.'
            identities = {n: self.identity(raw[n]) for n in names}
            token = digest([identities, devices, disks, types])
            active = [self.leases[n] for n in names if n in self.leases]
            ports.append({'id': names[0], 'ports': names, 'external': all(t == 'hotplug' for t in types),
                          'types': types, 'devices': devices, 'disks': disks, 'token': token,
                          'canDisconnect': not reason, 'reason': reason,
                          'powerSwitching': False if all(q.parent.parent.name.startswith('usb') for q in paths) and read(self.root / 'class/dmi/id/product_name') == 'Predator PT315-53' else None,
                          'connectionStates': [read(q / 'state', 'desconocido') for q in paths],
                          'remainingSeconds': max(0, int(max(v['until'] for v in active) - self.clock())) if active else None})
        expected = []
        fstab = Path('/etc/fstab') if str(self.root) == '/sys' else self.root.parent / 'etc/fstab'
        for line in read(fstab).splitlines():
            fields = line.split()
            if len(fields) >= 3 and fields[0].startswith('UUID=') and fields[1].startswith(('/mnt/', '/media/')):
                expected.append({'path': fields[1], 'uuid': fields[0][5:], 'detected': (self.dev / 'disk/by-uuid' / fields[0][5:]).exists()})
        return {'ok': True, 'available': True, 'model': read(self.root / 'class/dmi/id/product_name'), 'expectedVolumes': expected,
                'backend': 'linux-usb-port-disable', 'ports': ports, 'job': self.job,
                'physicalPowerVerified': False,
                'note': 'Reconexión de datos. Los puertos integrados de este modelo no permiten cortar los 5 V por software.' if read(self.root / 'class/dmi/id/product_name') == 'Predator PT315-53' else 'La desconexión de datos no confirma un corte eléctrico. VBUS requiere verificación física.'}

    def restore(self):
        errors = []
        raw = self.raw_ports()
        for name, lease in list(self.leases.items()):
            p = raw.get(name)
            # Never apply a stale journal to a different controller/hub.
            if p and self.identity(p) == lease['identity']:
                try:
                    (p / 'disable').write_text('0')
                    if read(p / 'disable') != '0':
                        raise OSError('El kernel no confirmó la habilitación de ' + name)
                except OSError as e:
                    errors.append(str(e))
                    continue
            self.leases.pop(name, None)
            self.save()
        if errors:
            raise RuntimeError('No se confirmó la restauración: ' + '; '.join(errors))

    def submit(self, request):
        if request.get('operation') not in ('cycle', 'disconnect', 'enable'):
            raise ValueError('Acción inválida')
        if request.get('operation') == 'disconnect' and (type(request.get('seconds')) is not int or request.get('seconds') not in (15, 30, 60)):
            raise ValueError('Elegí 15, 30 o 60 segundos.')
        with self.lock:
            if self.job and self.job['state'] in ('queued', 'running', 'restoring', 'disconnected'):
                if request.get('operation') == 'enable' and request.get('id') == self.job['port']:
                    self.job['restoreRequested'] = True
                    return {'ok': True, 'accepted': True, 'job': dict(self.job)}
                raise ValueError('Hay una operación USB en curso. Esperá la reconexión.')
            if self.leases and request['operation'] != 'enable':
                raise ValueError('Hay puertos pendientes de restauración. Habilitalos antes de otra operación.')
            port = next((p for p in self.inventory()['ports'] if p['id'] == request.get('id')), None)
            if not port or port['token'] != request.get('token'):
                raise ValueError('Los dispositivos cambiaron. Actualizá el estado del puerto.')
            if not port['external'] or request['operation'] != 'enable' and not port['canDisconnect']:
                raise ValueError(port['reason'] or 'Puerto protegido')
            self.job = {'port': port['id'], 'state': 'queued', 'operation': request['operation'], 'error': '', 'restoreRequested': False}
            thread = threading.Thread(target=self.execute, args=(dict(request),), daemon=True)
            thread.start()
            return {'ok': True, 'accepted': True, 'job': dict(self.job)}

    def execute(self, request):
        fds = []
        try:
            with self.lock:
                port = next((p for p in self.inventory()['ports'] if p['id'] == request['id']), None)
                if not port or port['token'] != request['token']:
                    raise ValueError('El dispositivo cambió antes de ejecutar. Volvé a consultar.')
                if request['operation'] != 'enable' and not port['canDisconnect']:
                    raise ValueError(port['reason'])
                paths = self.raw_ports()
                identities = {n: self.identity(paths[n]) for n in port['ports']}
                self.job['state'] = 'running'
                if request['operation'] != 'enable':
                    # Exclusive block claims reject open/mounted disks and prevent
                    # a mount racing the final check until the device is removed.
                    for b in port['disks']:
                        if not b['partition']:
                            fds.append(os.open(self.dev / b['name'], os.O_RDONLY | os.O_EXCL | os.O_NONBLOCK))
                    until = self.clock() + (request.get('seconds', 5) if request['operation'] == 'disconnect' else 5)
                    for n in port['ports']:
                        self.leases[n] = {'identity': self.identity(paths[n]), 'until': until}
                    self.save()  # before any port can be left disabled
            if request['operation'] == 'enable':
                if self.leases:
                    self.restore()
                else:
                    for n in port['ports']:
                        if self.identity(paths[n]) != identities[n]:
                            raise ValueError('El controlador USB cambió antes de habilitar.')
                        (paths[n] / 'disable').write_text('0')
                        if read(paths[n] / 'disable') != '0':
                            raise OSError('El kernel no confirmó la habilitación.')
            else:
                # Release devices from BOTH channels of the same connector.
                for i, n in enumerate(port['ports']):
                    # Revalidate enumeration immediately before each write.
                    if any(d not in port['devices'] for d in self.devices([paths[k] for k in port['ports'][i:]])):
                        raise ValueError('Apareció otro dispositivo durante la operación.')
                    if self.identity(paths[n]) != self.leases[n]['identity']:
                        raise ValueError('El controlador USB cambió durante la operación.')
                    (paths[n] / 'disable').write_text('1')
                    if read(paths[n] / 'disable') != '1':
                        raise OSError('El kernel no confirmó la desconexión del canal ' + n)
                with self.lock:
                    self.job['state'] = 'disconnected'
                    until = self.clock() + (request.get('seconds', 5) if request['operation'] == 'disconnect' else 5)
                    for n in port['ports']:
                        self.leases[n]['until'] = until
                    self.save()
                while self.clock() < until and not self.job['restoreRequested']:
                    time.sleep(0.1)
                with self.lock:
                    self.job['state'] = 'restoring'
                self.restore()
            with self.lock:
                self.job['state'] = 'completed'
        except Exception as e:
            with self.lock:
                self.job['error'] = 'No se confirmó la operación: ' + str(e)
                self.job['state'] = 'restoring'
            try:
                self.restore()
            except Exception as restore_error:
                self.job['error'] += '; ' + str(restore_error)
            with self.lock:
                self.job['state'] = 'failed'
        finally:
            for fd in fds:
                os.close(fd)

def serve():
    controller = UsbController()
    controller.restore()
    parent = Path(SOCKET).parent
    parent.mkdir(mode=0o700, exist_ok=True)
    os.chmod(parent, 0o700)
    Path(SOCKET).unlink(missing_ok=True)
    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            self.request.settimeout(3)
            _, uid, _ = struct.unpack('3i', self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if uid != 0:
                return
            try:
                raw = self.rfile.readline(4097)
                if len(raw) > 4096 or not raw.endswith(b'\n'):
                    raise ValueError('Solicitud inválida')
                request = json.loads(raw)
                if not isinstance(request, dict):
                    raise ValueError('Solicitud inválida')
                if request.get('action') == 'status':
                    with controller.lock:
                        result = controller.inventory()
                elif request.get('action') == 'set':
                    result = controller.submit(request)
                else:
                    raise ValueError('Acción inválida')
            except Exception as e:
                result = {'ok': False, 'error': str(e)}
            self.wfile.write(json.dumps(result).encode() + b'\n')
    class Server(socketserver.ThreadingUnixStreamServer):
        daemon_threads = True
    with Server(SOCKET, Handler) as server:
        os.chmod(SOCKET, 0o600)
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
        server.serve_forever(poll_interval=0.2)

def client(request):
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(5)
        connection.connect(SOCKET)
        connection.sendall(json.dumps(request).encode() + b'\n')
        with connection.makefile('rb') as f:
            return json.loads(f.readline(262145))

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'serve':
        serve()
    elif len(sys.argv) > 1 and sys.argv[1] == 'restore':
        UsbController().restore()
    else:
        try:
            result = client(json.load(sys.stdin))
        except Exception:
            result = {'ok': False, 'available': False, 'error': 'El servicio USB no está disponible. Comprobá axon-usb.service en el host.'}
        print(json.dumps(result))

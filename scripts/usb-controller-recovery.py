#!/usr/bin/env python3
"""One-shot recovery for this host, run under systemd with ExecStopPost restore.
No general PCI write API. Unmount normally; never force or lazily unmount.
"""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time

PCI = '0000:00:14.0'
DRIVER = Path('/sys/bus/pci/drivers/xhci_hcd')
DEVICE = Path('/sys/bus/pci/devices') / PCI
STATE = Path('/var/lib/axon-usb/controller-recovery-20261011.json')
REPORT = Path('/var/lib/axon-usb/controller-recovery-20261011-result.json')
DATA = Path('/home/binary/server-stack/axon/data')
VOLUMES = [
    {'path': '/mnt/DATOS', 'uuid': '03252d72-d684-49c8-a069-6297539c5133'},
    {'path': '/mnt/axon-disks/35e9e6ca634f7538', 'uuid': '9b6a2e73-0a1c-4922-bb18-5fe81328254d'}
]

def run(*args, check=True, timeout=30):
    return subprocess.run(args, capture_output=True, text=True, check=check, timeout=timeout)

def active(unit):
    return run('systemctl', 'is-active', '--quiet', unit, check=False).returncode == 0

def docker_running():
    return run('docker', 'inspect', '--format', '{{.State.Running}}', 'axon').stdout.strip() == 'true'

def save(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    with open(temp, 'w') as f:
        os.chmod(temp, 0o600)
        json.dump(value, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temp, path)

def mount_records():
    return [line.split() for line in Path('/proc/self/mountinfo').read_text().splitlines()]

def block_identity(uuid):
    p = Path('/dev/disk/by-uuid') / uuid
    if not p.exists():
        return None
    s = p.stat()
    return f'{os.major(s.st_rdev)}:{os.minor(s.st_rdev)}'

def mounted(v):
    number = block_identity(v['uuid'])
    return number and any(r[2] == number and r[4] == v['path'] for r in mount_records())

def usb_devices():
    found = []
    for p in Path('/sys/bus/usb/devices').iterdir():
        if not (p / 'idVendor').exists() or '0000:00:14.0' not in str(p.resolve()) or p.name.startswith('usb'):
            continue
        found.append((p / 'idVendor').read_text().strip() + ':' + (p / 'idProduct').read_text().strip())
    return sorted(found)

def restore():
    if not STATE.exists():
        return
    state = json.loads(STATE.read_text())
    if not state.get('armed'):
        return
    errors = []
    if not (DEVICE / 'driver').exists():
        try:
            (DRIVER / 'bind').write_text(PCI)
        except Exception as e:
            errors.append('Controlador: ' + str(e))
    elif (DEVICE / 'driver').resolve() != DRIVER:
        errors.append('El dispositivo PCI tiene otro controlador; no se modifica.')
    # Restore only the original units and mounts, by UUID, never by /dev/sdX.
    for v in state['volumes']:
        try:
            if v['automountActive']:
                run('systemctl', 'start', v['autoUnit'])
            if v['mountedBefore']:
                until = time.monotonic() + 20
                while not block_identity(v['uuid']) and time.monotonic() < until:
                    time.sleep(0.2)
                if not block_identity(v['uuid']):
                    raise RuntimeError('No reapareció el volumen ' + v['uuid'])
                run('systemctl', 'start', v['mountUnit'])
                if not mounted(v):
                    raise RuntimeError('No se confirmó el montaje original')
        except Exception as e:
            errors.append('Volumen: ' + str(e))
    try:
        if state['usbServiceActive']:
            run('systemctl', 'start', 'axon-usb.service')
        if state['axonRunning'] and not docker_running():
            run('docker', 'start', 'axon')
    except Exception as e:
        errors.append('Servicios: ' + str(e))
    state['restorationErrors'] = errors
    state['armed'] = bool(errors)
    save(STATE, state)
    if errors:
        raise RuntimeError('; '.join(errors))

def recover():
    assert os.geteuid() == 0
    assert Path('/sys/class/dmi/id/product_name').read_text().strip() == 'Predator PT315-53'
    assert Path('/sys/class/dmi/id/bios_version').read_text().strip() == 'V1.14'
    assert (DEVICE / 'driver').resolve() == DRIVER
    assert not STATE.exists(), 'Ya hay una ejecución registrada; no se repite automáticamente.'
    db = sqlite3.connect('file:' + str(DATA / 'maintenance/maintenance.sqlite') + '?mode=ro', uri=True)
    assert db.execute('select count(*) from locks').fetchone()[0] == 0, 'Hay operaciones de archivos pendientes.'
    db.close()
    leases = Path('/var/lib/axon-usb/leases.json')
    assert not leases.exists() or json.loads(leases.read_text()) == {}, 'Operación USB pendiente'
    volumes = []
    for v in VOLUMES:
        v = dict(v)
        unit = run('systemd-escape', '--path', '--suffix=mount', v['path']).stdout.strip()
        v.update(mountUnit=unit, autoUnit=unit.removesuffix('.mount') + '.automount')
        v.update(automountActive=active(v['autoUnit']), mountedBefore=bool(mounted(v)))
        if v['mountedBefore']:
            assert not run('fuser', '-m', v['path'], check=False).stdout.strip(), 'Hay archivos abiertos en el disco'
            v['rootListingHash'] = hashlib.sha256(json.dumps(sorted(p.name for p in Path(v['path']).iterdir())).encode()).hexdigest()
        volumes.append(v)
    state = {'armed': True, 'volumes': volumes, 'axonRunning': docker_running(),
             'usbServiceActive': active('axon-usb.service'), 'devicesBefore': usb_devices(), 'controller': PCI}
    save(STATE, state)  # recovery guard before the first effect
    report = {'controller': PCI, 'ok': False, 'wdDetected': False, 'errors': []}
    try:
        if state['axonRunning']:
            run('docker', 'stop', '-t', '20', 'axon')
        if state['usbServiceActive']:
            run('systemctl', 'stop', 'axon-usb.service')
        # Stop automounts first, so a background reader cannot remount a disk.
        for v in volumes:
            if v['automountActive']:
                run('systemctl', 'stop', v['autoUnit'])
            if v['mountedBefore']:
                run('systemctl', 'stop', v['mountUnit'])
        assert not any(mounted(v) for v in volumes), 'Un disco sigue montado'
        for v in volumes:
            if v['mountedBefore']:
                part = (Path('/dev/disk/by-uuid') / v['uuid']).resolve().name
                sysblock = Path('/sys/class/block') / part
                disk = sysblock.resolve().parent.name if (sysblock / 'partition').exists() else part
                fd = os.open('/dev/' + disk, os.O_RDONLY | os.O_EXCL | os.O_NONBLOCK)
                os.close(fd)
        os.sync()
        print('Discos desmontados; reinicializando el controlador PCI USB', flush=True)
        (DRIVER / 'unbind').write_text(PCI)
        assert not (DEVICE / 'driver').exists()
        time.sleep(5)
        (DRIVER / 'bind').write_text(PCI)
        assert (DEVICE / 'driver').resolve() == DRIVER
        print('Controlador conectado nuevamente; esperando dispositivos', flush=True)
        until = time.monotonic() + 20
        while time.monotonic() < until:
            if block_identity(VOLUMES[0]['uuid']) and block_identity(VOLUMES[1]['uuid']):
                break
            time.sleep(0.5)
        report['controllerReinitialized'] = True
        report['wdDetected'] = bool(block_identity(VOLUMES[0]['uuid']))
    except Exception as e:
        report['errors'].append(str(e))
    finally:
        try:
            restore()
            report['restorationVerified'] = True
        except Exception as e:
            report['errors'].append('Restauración: ' + str(e))
        report['devicesAfter'] = usb_devices()
        report['originalDevicesReturned'] = state['devicesBefore'] == report['devicesAfter']
        report['originalMountsRestored'] = all(not v['mountedBefore'] or mounted(v) for v in volumes)
        report['rootListingsPreserved'] = all(not v['mountedBefore'] or mounted(v) and v['rootListingHash'] == hashlib.sha256(json.dumps(sorted(p.name for p in Path(v['path']).iterdir())).encode()).hexdigest() for v in volumes)
        report['axonRunning'] = docker_running()
        report['usbServiceActive'] = active('axon-usb.service')
        report['ok'] = not report['errors'] and report.get('controllerReinitialized') and report['originalDevicesReturned'] and report['originalMountsRestored'] and report['rootListingsPreserved'] and report['axonRunning'] and report['usbServiceActive']
        save(REPORT, report)
        print(json.dumps(report), flush=True)
    if not report['ok']:
        raise RuntimeError('La recuperación requiere revisar el resultado registrado.')

if __name__ == '__main__':
    if len(sys.argv) == 2 and sys.argv[1] == 'restore':
        restore()
    elif len(sys.argv) == 2 and sys.argv[1] == 'recover':
        recover()
    else:
        raise SystemExit('Usar recover o restore bajo la unidad systemd de recuperación.')

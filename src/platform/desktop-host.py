"""Dedicated graphical session; fixed server-owned commands and private X auth."""
import fcntl
import json
import os
import secrets
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

DISPLAY = ':117'
VNC_PORT = 5917
WS_PORT = 6117
APPS = {'terminal': ['/usr/bin/xterm'], 'browser': ['/usr/bin/google-chrome'], 'files': ['/usr/bin/thunar'],
        'editor': ['/usr/bin/mousepad'], 'firefox': ['/usr/bin/firefox']}

def folder(home):
    home = Path(home)
    if not home.is_absolute() or str(home) != os.path.normpath(str(home)) or not home.is_dir() or home.stat().st_uid != os.getuid(): raise ValueError('Identidad de escritorio inválida')
    base = home / '.local/share/axon/desktop'
    for p in [base, *base.parents]:
        if p.is_symlink(): raise ValueError('Escritorio enlazado no permitido')
    base.mkdir(parents=True, exist_ok=True, mode=0o700)
    if base.stat().st_uid != os.getuid() or base.stat().st_mode & 0o077: raise ValueError('Estado de escritorio no privado')
    os.environ.update(HOME=str(home), XDG_RUNTIME_DIR='/run/user/' + str(os.getuid()),
                      DBUS_SESSION_BUS_ADDRESS='unix:path=/run/user/' + str(os.getuid()) + '/bus')
    return base

def unit(command):
    p = subprocess.run(['systemctl', '--user', *command], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
    if p.returncode: raise RuntimeError('No se pudo gestionar la sesión gráfica del usuario')
    return p.stdout.decode()

def connected(port):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=1): return True
    except OSError: return False

def status(home):
    base = folder(home)
    p = subprocess.run(['systemctl', '--user', 'show', 'axon-desktop.service', '-p', 'ActiveState', '-p', 'MainPID'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
    props = dict(line.split('=', 1) for line in p.stdout.decode().splitlines() if '=' in line)
    missing = [name for name in ['Xvfb', 'x11vnc', 'websockify', 'openbox', 'xauth'] if not subprocess.run(['/usr/bin/which', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0]
    return dict(ok=True, state=props.get('ActiveState', 'not-installed'), pid=int(props.get('MainPID', '0')), connected=connected(WS_PORT) and connected(VNC_PORT),
                applications=[dict(id=k, name={'terminal':'Terminal', 'browser':'Chrome', 'files':'Archivos', 'editor':'Editor de texto', 'firefox':'Firefox'}[k]) for k,v in APPS.items() if Path(v[0]).is_file()],
                missing=missing, display=DISPLAY, session='Sesión dedicada de AXON', websocketPort=WS_PORT)

def install(home, source):
    base = folder(home)
    current = status(home)
    if current['missing']: raise ValueError('Faltan herramientas gráficas: ' + ', '.join(current['missing']))
    script = base / 'session.py'
    if script.is_symlink(): raise ValueError('Launcher enlazado no permitido')
    temp = base / ('session.' + secrets.token_hex(8) + '.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as f: f.write(source)
    os.replace(temp, script)
    units = Path(home) / '.config/systemd/user'; units.mkdir(parents=True, exist_ok=True)
    for p in [units, *units.parents]:
        if p.is_symlink(): raise ValueError('Ruta de unidades enlazada')
    service = units / 'axon-desktop.service'
    if service.is_symlink() or (service.exists() and '# AXON dedicated desktop v1' not in service.read_text()): raise ValueError('Existe una unidad ajena a AXON')
    service.write_text('# AXON dedicated desktop v1\n[Unit]\nDescription=AXON dedicated graphical desktop\nAfter=default.target\n\n[Service]\nType=simple\nExecStart=/usr/bin/python3 ' + str(script) + ' supervise ' + str(home) + '\nRestart=on-failure\nRestartSec=3\nKillMode=control-group\nTimeoutStopSec=10\n\n[Install]\nWantedBy=default.target\n')
    os.chmod(service, 0o600); unit(['daemon-reload']); unit(['enable', '--now', 'axon-desktop.service'])
    return status(home)

def supervise(home):
    base = folder(home); lock = os.open(base / 'session.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if Path('/tmp/.X11-unix/X117').exists() or connected(VNC_PORT) or connected(WS_PORT): raise RuntimeError('El display o puerto de AXON está ocupado por otra sesión')
    authority = base / 'Xauthority'
    if authority.is_symlink(): raise ValueError('Xauthority enlazado no permitido')
    authority.touch(mode=0o600, exist_ok=True); os.chmod(authority, 0o600)
    subprocess.run(['xauth', '-f', str(authority), 'add', DISPLAY, '.', secrets.token_hex(16)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    env = dict(os.environ, DISPLAY=DISPLAY, XAUTHORITY=str(authority))
    children = []
    def cleanup():
        for child in reversed(children):
            if child.poll() is None: child.terminate()
        deadline = time.monotonic()+5
        for child in children:
            try: child.wait(timeout=max(.1,deadline-time.monotonic()))
            except subprocess.TimeoutExpired: child.kill()
    def stop(*_):
        cleanup(); sys.exit(0)
    signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGINT, stop)
    try:
        children.append(subprocess.Popen(['Xvfb', DISPLAY, '-screen', '0', '1440x900x24', '-nolisten', 'tcp', '-auth', str(authority)], env=env))
        for _ in range(50):
            if Path('/tmp/.X11-unix/X117').exists(): break
            if children[0].poll() is not None: raise RuntimeError('Xvfb no inició')
            time.sleep(.1)
        children.append(subprocess.Popen(['openbox'], env=env))
        children.append(subprocess.Popen(['x11vnc', '-display', DISPLAY, '-auth', str(authority), '-localhost', '-rfbport', str(VNC_PORT), '-forever', '-shared', '-nopw', '-quiet'], env=env))
        children.append(subprocess.Popen(['websockify', '127.0.0.1:' + str(WS_PORT), '127.0.0.1:' + str(VNC_PORT)], env=env))
        while all(child.poll() is None for child in children): time.sleep(1)
        raise RuntimeError('Una herramienta de la sesión gráfica terminó')
    finally: cleanup()

def main(request):
    home = request['home']; base = folder(home); action = request.get('action')
    if action == 'status': return status(home)
    if action == 'start': return install(home, request['workerSource'])
    if action == 'stop': unit(['stop', 'axon-desktop.service']); return status(home)
    if action == 'launch':
        if not status(home)['connected']: raise ValueError('El escritorio todavía no está conectado')
        app = request.get('app')
        if app not in APPS or not Path(APPS[app][0]).is_file(): raise ValueError('Aplicación no disponible')
        argv = list(APPS[app])
        if app == 'browser': argv += ['--user-data-dir=' + str(base / 'chrome'), '--no-first-run', '--disable-session-crashed-bubble']
        if app == 'firefox':
            profile = base / 'firefox'; profile.mkdir(exist_ok=True, mode=0o700); argv += ['--no-remote', '--profile', str(profile)]
        env = dict(os.environ, DISPLAY=DISPLAY, XAUTHORITY=str(base / 'Xauthority'))
        name = 'axon-desktop-app-' + secrets.token_hex(8)
        result = subprocess.run(['systemd-run', '--user', '--collect', '--quiet', '--unit=' + name,
                                 '--property=BindsTo=axon-desktop.service', '--property=After=axon-desktop.service',
                                 '/usr/bin/env', 'DISPLAY=' + DISPLAY, 'XAUTHORITY=' + str(base / 'Xauthority'), *argv],
                                env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
        if result.returncode: raise RuntimeError('La aplicación no pudo abrirse')
        return dict(ok=True, app=app, unit=name)
    raise ValueError('Acción inválida')

if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == 'supervise': supervise(sys.argv[2])
    else:
        try: print(json.dumps(main(json.load(sys.stdin))))
        except Exception as e: print(json.dumps(dict(ok=False,error=str(e)[:240])))

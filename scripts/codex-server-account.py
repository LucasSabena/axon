#!/usr/bin/env python3
"""Reconcile desktop SSH auth without interrupting active Codex turns.

Uses the installed version's account/read and thread APIs over its private
Unix WebSocket, then its supported daemon restart command. No token RPCs,
inference, logout or thread mutations. Credentials remain owned by profiles.
"""
import asyncio
import contextlib
import fcntl
import importlib.machinery
import importlib.util
import json
import os
import re
import signal
import socket
import struct
from pathlib import Path
import shutil
import subprocess
import sys
import time

try:
    import websockets
except ImportError:
    # A missing host module must not leave a raw traceback or a status file
    # stuck in 'pending'; exit cleanly so the caller sees a plain failure.
    print('Falta el módulo websockets en el Python del host', file=sys.stderr)
    sys.exit(1)


class Desktop:
    def __init__(self, home):
        self.home = Path(home)
        self.socket = self.home / '.codex/app-server-control/app-server-control.sock'
        self.ws = None
        self.sequence = 0
        self.peer_pid = None
        self.peer_fd = None

    async def __aenter__(self):
        # The daemon protects this socket on the owning user's filesystem.
        self.ws = await websockets.unix_connect(str(self.socket), uri='ws://localhost/', open_timeout=5, max_size=4_000_000)
        try:
            sock = self.ws.transport.get_extra_info('socket')
            pid, uid, _ = struct.unpack('3i', sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if uid != os.getuid():
                raise RuntimeError('El servidor de Codex pertenece a otro usuario')
            self.peer_pid = pid
            self.peer_fd = os.pidfd_open(pid)
            await self.rpc('initialize', {'clientInfo': {'name': 'axon_server_accounts', 'version': '1'}})
            await self.ws.send('{"method":"initialized"}')
        except BaseException:
            await self.__aexit__()
            raise
        return self

    async def __aexit__(self, *_):
        if self.ws: await self.ws.close()
        if self.peer_fd is not None: os.close(self.peer_fd); self.peer_fd = None

    async def rpc(self, method, params):
        self.sequence += 1
        ident = self.sequence
        await self.ws.send(json.dumps({'id': ident, 'method': method, 'params': params}))
        async with asyncio.timeout(15):
            while True:
                message = json.loads(await self.ws.recv())
                if message.get('id') != ident: continue
                if 'error' in message: raise RuntimeError('No se pudo verificar el estado del servidor de Codex')
                return message['result']

    async def account(self):
        d = await self.rpc('account/read', {'refreshToken': False})
        return {'email': (d.get('account') or {}).get('email'), 'accountId': (d.get('workspaceRouting') or {}).get('chatgptAccountId')}

    async def busy(self):
        cursor = None
        examined = 0
        while True:
            params = {'limit': 100}
            if cursor: params['cursor'] = cursor
            result = await self.rpc('thread/loaded/list', params)
            for ident in result['data']:
                thread = (await self.rpc('thread/read', {'threadId': ident, 'includeTurns': False}))['thread']
                state = thread.get('status', {}).get('type')
                # Unrecognized state is uncertainty, never proof of idle.
                if state not in ['idle', 'notLoaded', 'systemError']: return True
                examined += 1
                if examined >= 2000: return True
            cursor = result.get('nextCursor')
            if not cursor: return False

    async def stop_direct_server(self):
        """Gracefully adopt the SSH-created server, never a PID guessed by name.

        Unix peer credentials identify the engine answering our verified RPCs.
        A pidfd pins that process while we validate its home, owner and command.
        No SIGKILL; credentials remain on their old owner until it has exited.
        """
        proc = Path('/proc') / str(self.peer_pid)
        args = (proc / 'cmdline').read_bytes().decode(errors='replace').split('\0')
        env = dict(x.split('=', 1) for x in (proc / 'environ').read_bytes().decode(errors='replace').split('\0') if '=' in x)
        actual_home = Path(env.get('CODEX_HOME') or str(Path(env.get('HOME', '/')) / '.codex'))
        if proc.stat().st_uid != os.getuid() or Path(os.readlink(proc / 'exe')).name != 'codex' or 'app-server' not in args or '--listen' not in args or actual_home != self.home / '.codex':
            raise RuntimeError('No se pudo validar el proceso de Codex abierto por SSH')
        if await self.busy(): return False
        signal.pidfd_send_signal(self.peer_fd, signal.SIGTERM)
        import select
        for _ in range(200):
            if select.select([self.peer_fd], [], [], 0)[0]: return True
            await asyncio.sleep(.1)
        raise RuntimeError('El servidor de Codex no terminó su cierre; se conservaron las credenciales anteriores')


def selected(store):
    state = store.load()['agents']['codex']
    ident = state['active']
    auth = store.profile_home('codex', ident) / 'auth.json'
    # Read identifiers only; never send credentials over desktop RPC.
    d = json.loads(auth.read_text())
    account_id = (d.get('tokens') or {}).get('account_id')
    if not account_id: raise RuntimeError('La cuenta seleccionada no tiene una identidad de ChatGPT verificable')
    return ident, account_id, store.identity('codex', ident)['email']


def daemon_features(home):
    """Preserve desktop-supplied feature flags, e.g. its Code Mode host.

    Capture only boolean feature overrides from this user's native daemon;
    never export other process arguments or credential environment values.
    """
    home = Path(home)
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit(): continue
        try:
            if proc.stat().st_uid != home.stat().st_uid: continue
            args = (proc / 'cmdline').read_bytes().decode(errors='replace').split('\0')
            if 'app-server' not in args or '--listen' not in args: continue
            env = dict(x.split('=', 1) for x in (proc / 'environ').read_bytes().decode(errors='replace').split('\0') if '=' in x)
            if Path(env.get('CODEX_HOME') or str(Path(env.get('HOME', '/')) / '.codex')) != home / '.codex': continue
            flags = []
            for i, arg in enumerate(args[:-1]):
                if arg in ['-c', '--config'] and re.fullmatch(r'features\.[a-z_]+=(true|false)', args[i+1]): flags += ['-c', args[i+1]]
            return flags
        except (OSError, ValueError): continue
    return []


async def reconcile(store, atomic, *, once=False, restart=None, desktop_factory=Desktop):
    def report(state, ident, **extra):
        atomic(store.root / 'desktop-status.json', json.dumps({'state': state, 'selectedId': ident, 'updatedAt': int(time.time()), **extra}) + '\n')
    while True:
        ident, expected, email = selected(store)
        try:
            async with desktop_factory(store.home) as desktop:
                account = await desktop.account()
                if account['accountId'] == expected:
                    with store.lock():
                        if selected(store)[0] != ident: continue
                        report('ready', ident, email=account['email'], verified=True)
                    return
                if await desktop.busy():
                    report('pending', ident, email=account['email'], verified=False, reason='active-turns')
                    if once: return
                    await asyncio.sleep(2)
                    continue
                # Keep a concurrent account click from racing the restart.
                with store.lock():
                    if selected(store)[0] != ident: continue
                    if await desktop.busy(): continue
                    report('restarting', ident, email=account['email'], verified=False)
                    if restart:
                        await restart()
                    else:
                        env = {**os.environ, 'HOME': str(store.home), 'CODEX_HOME': str(store.home / '.codex')}
                        for key in ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN']: env.pop(key, None)
                        features = daemon_features(store.home)
                        if features:
                            # Lifecycle start ignores CLI config overrides in
                            # 0.160. Preserve the existing daemon features in
                            # its own settings; restart reuses that snapshot.
                            settings_path = store.home / '.codex/app-server-daemon/settings.json'
                            if settings_path.is_symlink(): raise RuntimeError('Configuración de daemon no administrada')
                            settings = json.loads(settings_path.read_text()) if settings_path.exists() else {}
                            saved = settings.setdefault('featureOverrides', {})
                            for value in features[1::2]:
                                key, enabled = value.split('=', 1)
                                saved[key.removeprefix('features.')] = enabled == 'true'
                            atomic(settings_path, json.dumps(settings) + '\n')
                        cmd = [shutil.which('codex'), 'app-server', 'daemon']
                        # Stop before changing the auth link: an in-flight
                        # old-account refresh must never write into the new
                        # account's credential file.
                        result = await asyncio.to_thread(subprocess.run, cmd + ['stop'], env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
                        if result.returncode:
                            # SSH starts a direct app-server that the daemon
                            # lifecycle deliberately refuses to administer.
                            if not await desktop.stop_direct_server(): continue
                        store.point_server_auth(ident)
                        result = await asyncio.to_thread(subprocess.run, cmd + ['restart'], env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
                        # The desktop may reconnect itself during adoption.
                        # Verify its actual identity even if restart reports
                        # an already-running direct SSH server.
            # Verify the fresh daemon on a new socket, not cached UI labels.
            for _ in range(20):
                try:
                    async with desktop_factory(store.home) as desktop:
                        account = await desktop.account()
                        if account['accountId'] == expected:
                            with store.lock():
                                if selected(store)[0] != ident: break
                                report('ready', ident, email=account['email'], verified=True)
                            return
                        break
                except (OSError, TimeoutError, websockets.WebSocketException): await asyncio.sleep(.5)
            if selected(store)[0] != ident: continue
            raise RuntimeError('La conexión de Codex todavía no coincide con la cuenta seleccionada')
        except FileNotFoundError:
            with store.lock():
                if selected(store)[0] != ident: continue
                store.point_server_auth(ident)
            report('offline', ident, email=email, verified=False)
            return
        except (OSError, TimeoutError, RuntimeError, ValueError, TypeError, websockets.WebSocketException):
            report('error', ident, verified=False, reason='verification-failed')
            return


def main():
    home = Path(sys.argv[1])
    loader = importlib.machinery.SourceFileLoader('axon_accounts', str(home / '.local/bin/axon-agent'))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    accounts = importlib.util.module_from_spec(spec); loader.exec_module(accounts)
    store = accounts.Store(home)
    fd = os.open(accounts.safe(store.root / '.desktop-reconcile.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        # Serialize workers rather than discarding a click at the exact moment
        # the previous worker exits. Each worker rereads the latest intent.
        fcntl.flock(fd, fcntl.LOCK_EX)
        asyncio.run(reconcile(store, accounts.atomic))
    finally: os.close(fd)


if __name__ == '__main__': main()

"""Read the host's block devices and live mount namespace as its normal user.
Mounting is an explicit constrained action; no formatting or permission rewrites.
"""
import hashlib, json, os, pwd, re, stat, subprocess, sys

FILESYSTEM_CONTAINERS = {'LVM2_member', 'crypto_LUKS', 'linux_raid_member', 'swap', 'zfs_member'}

def inventory():
    result = subprocess.run(['lsblk', '--json', '--bytes', '--paths', '--output',
        'NAME,TYPE,SIZE,FSTYPE,LABEL,UUID,MAJ:MIN,RM,HOTPLUG,TRAN,MODEL,RO'],
        capture_output=True, text=True, timeout=8, check=True)
    devices, blocks = [], {}
    def walk(node, disk=None):
        if node['type'] in ('loop', 'rom'): return
        if node['type'] == 'disk':
            disk = {'id': node['name'], 'name': (node.get('model') or os.path.basename(node['name'])).strip(),
                'device': node['name'], 'size': int(node.get('size') or 0),
                'external': bool(node.get('rm') or node.get('hotplug') or node.get('tran') == 'usb'),
                'transport': node.get('tran')}
            devices.append(disk)
        if disk and node.get('fstype') and node['fstype'] not in FILESYSTEM_CONTAINERS:
            blocks.setdefault(node['maj:min'], {**node, 'disk': disk})
        for child in node.get('children', []): walk(child, disk)
    for node in json.loads(result.stdout)['blockdevices']: walk(node)
    mounts = {}
    def unescape(value): return re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), value)
    with open('/proc/self/mountinfo') as stream:
        for line in stream:
            left, right = line.rstrip().split(' - ', 1)
            fields = left.split(); extra = right.split()
            major = fields[2]
            # NTFS-3G uses a virtual FUSE device number. Its mount source still
            # identifies the physical block device listed by lsblk.
            if major not in blocks:
                try:
                    source = os.stat(unescape(extra[1]))
                    if stat.S_ISBLK(source.st_mode): major = str(os.major(source.st_rdev)) + ':' + str(os.minor(source.st_rdev))
                except OSError: pass
            if major not in blocks or fields[3] != '/': continue  # don't turn bind mounts into disks
            target = unescape(fields[4])
            mounts.setdefault(major, []).append({'path': target, 'mountId': fields[0],
                'readOnly': 'ro' in fields[5].split(',') or 'ro' in extra[2].split(',')})
    volumes = []
    for major, node in blocks.items():
        mounted = mounts.get(major) or [None]
        for mount in mounted:
            target = mount['path'] if mount else None
            key = '\0'.join([node.get('uuid') or '', major, target or ''])
            volume = {'id': hashlib.sha256(key.encode()).hexdigest()[:24],
                'diskId': node['disk']['id'], 'device': node['name'], 'majorMinor': major,
                'name': node.get('label') or ('Disco del sistema' if target == '/' else os.path.basename(target or node['name'])),
                'filesystem': node['fstype'], 'uuid': node.get('uuid'), 'size': int(node.get('size') or 0),
                'external': node['disk']['external'], 'path': target,
                'mountId': mount['mountId'] if mount else None,
                'readOnly': bool(node.get('ro') or mount and mount['readOnly']),
                'readable': bool(target and os.access(target, os.R_OK | os.X_OK)), 'available': None, 'used': None,
                'canMount': not mount and node['disk']['external']}
            if target:
                try:
                    capacity = os.statvfs(target)
                    volume['available'] = capacity.f_bavail * capacity.f_frsize
                    volume['size'] = capacity.f_blocks * capacity.f_frsize
                    volume['used'] = (capacity.f_blocks - capacity.f_bfree) * capacity.f_frsize
                except OSError: volume['readable'] = False
            volumes.append(volume)
    volumes.sort(key=lambda v: (v['path'] != '/', not v['external'], v['name']))
    return {'ok': True, 'devices': devices, 'volumes': volumes}

try:
    request = json.loads(sys.stdin.read(4096) or '{}')
    data = inventory()
    if request.get('action') == 'mount':
        matches = [v for v in data['volumes'] if v['id'] == request.get('id')]
        if len(matches) != 1: raise ValueError('El disco cambió o fue desconectado. Actualizá la lista.')
        volume = matches[0]
        if not volume['path']:
            if not volume['canMount']: raise ValueError('Este volumen debe montarse desde el sistema.')
            device = os.stat(volume['device'])
            if '%d:%d' % (os.major(device.st_rdev), os.minor(device.st_rdev)) != volume['majorMinor']:
                raise ValueError('La identidad del disco cambió.')
            if os.getuid() == 0:
                # A remote server has no interactive polkit session. Mount only a
                # currently detected external filesystem into an owned directory.
                account = pwd.getpwnam(request['user'])
                if account.pw_uid == 0: raise ValueError('Se requiere un usuario no privilegiado.')
                filesystem = volume['filesystem']
                if filesystem not in ('ext4', 'xfs', 'btrfs', 'exfat', 'vfat', 'ntfs', 'ntfs3'):
                    raise ValueError('Este formato debe montarse desde el sistema.')
                parent = '/mnt/axon-disks'
                target = parent + '/' + hashlib.sha256((volume['uuid'] or volume['majorMinor']).encode()).hexdigest()[:16]
                for directory in (parent, target):
                    try: os.mkdir(directory, 0o755)
                    except FileExistsError: pass
                    check = os.lstat(directory)
                    if not stat.S_ISDIR(check.st_mode) or check.st_uid != 0 or check.st_mode & 0o022:
                        raise ValueError('El directorio de montaje no es seguro.')
                flags = 'nosuid,nodev'
                if filesystem in ('exfat', 'vfat', 'ntfs', 'ntfs3'):
                    flags += ',uid=%d,gid=%d,umask=0022' % (account.pw_uid, account.pw_gid)
                if volume['readOnly']: flags += ',ro'
                # Pin the device so /dev name reuse cannot mount a replacement.
                fd = os.open(volume['device'], os.O_RDONLY | os.O_NOFOLLOW)
                try:
                    check = os.fstat(fd)
                    if '%d:%d' % (os.major(check.st_rdev), os.minor(check.st_rdev)) != volume['majorMinor']:
                        raise ValueError('La identidad del disco cambió.')
                    mounted = subprocess.run(['mount', '-t', filesystem, '-o', flags, '/proc/self/fd/%d' % fd, target],
                        pass_fds=(fd,), capture_output=True, text=True, timeout=12)
                finally: os.close(fd)
            else:
                mounted = subprocess.run(['udisksctl', 'mount', '--no-user-interaction', '--block-device', volume['device']],
                    capture_output=True, text=True, timeout=12)
            if mounted.returncode: raise ValueError('No se pudo montar el disco. Revisá permisos, formato o montalo desde el sistema.')
            data = inventory()
        paths = [v['path'] for v in data['volumes'] if v['majorMinor'] == volume['majorMinor'] and v['uuid'] == volume['uuid'] and v['path']]
        if not paths: raise ValueError('El montaje no se confirmó. Actualizá la lista.')
        data['path'] = paths[0]
    print(json.dumps(data))
except (OSError, ValueError, subprocess.SubprocessError, KeyError):
    message = str(sys.exc_info()[1]) if isinstance(sys.exc_info()[1], ValueError) else 'No se pudieron consultar o montar los discos del servidor.'
    print(json.dumps({'ok': False, 'error': message}))

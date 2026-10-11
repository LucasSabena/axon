"""AXON disk management. Inventory never mutates; every host change consumes a
session-bound, expiring plan. No arbitrary paths, shell, force, lazy unmount or
resize. Destructive jobs are detached and keep durable receipts on the host.
"""
import contextlib, fcntl, hashlib, json, os, pwd, re, shutil, stat, struct, subprocess, sys, time, uuid

STATE = '/var/lib/axon/disk-manager'
FSTAB = '/etc/fstab'
ENV = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'}
FILESYSTEMS = {
    'ext4': {'name': 'ext4', 'description': 'Para discos que se quedan en el servidor Linux. Conserva permisos y enlaces; adecuado para archivos y respaldos.', 'tool': 'mkfs.ext4', 'type': '0fc63daf-8483-4772-8e79-3d69d8477de4'},
    'exfat': {'name': 'exFAT', 'description': 'Para compartir archivos grandes con Windows y macOS. No conserva permisos Linux ni enlaces simbólicos.', 'tool': 'mkfs.exfat', 'type': 'ebd0a0a2-b9e5-4433-87c0-68b6b72699c7'},
}
CONTAINERS = {'LVM2_member', 'crypto_LUKS', 'linux_raid_member', 'zfs_member', 'swap'}
TECHNICAL = {'c12a7328-f81f-11d2-ba4b-00a0c93ec93b', '21686148-6449-6e6f-744e-656564454649'}

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def run(argv, input=None, timeout=30, fds=(), check=True):
    p = subprocess.run(argv, input=input, capture_output=True, text=True, timeout=timeout, pass_fds=fds, env=ENV)
    if check and p.returncode:
        raise ValueError('La herramienta del sistema no completó la operación. Revisá el resultado antes de volver a intentar.')
    return p

def unescape(s):
    return re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), s)

def mounts_all():
    """Include container mount namespaces: a host-unmounted disk can still be busy."""
    result, seen = {}, set()
    for pid in ['self'] + sorted(p for p in os.listdir('/proc') if p.isdigit()):
        try:
            namespace = os.readlink('/proc/%s/ns/mnt' % pid)
            if namespace in seen: continue
            with open('/proc/%s/mountinfo' % pid) as stream:
                for line in stream:
                    left, right = line.rstrip().split(' - ', 1)
                    f, r = left.split(), right.split()
                    major = f[2]
                    # NTFS/FUSE mount numbers are virtual; map their source too.
                    try:
                        source = os.stat(unescape(r[1]))
                        if stat.S_ISBLK(source.st_mode): major = '%d:%d' % (os.major(source.st_rdev), os.minor(source.st_rdev))
                    except OSError: pass
                    result.setdefault(major, []).append({'path': unescape(f[4]), 'namespace': namespace, 'id': f[0], 'root': unescape(f[3]), 'readOnly': 'ro' in f[5].split(',')})
            seen.add(namespace)
        except (FileNotFoundError, ProcessLookupError): continue
        except PermissionError:
            if os.geteuid() == 0: raise ValueError('No se pudo comprobar si otro servicio está usando el disco.')
    return result

def read_sys(p):
    try:
        with open(p) as f: return f.read().strip()
    except FileNotFoundError: return ''

def inventory():
    p = run(['lsblk', '--json', '--bytes', '--paths', '--output', 'NAME,KNAME,TYPE,SIZE,FSTYPE,LABEL,UUID,PARTUUID,PARTTYPE,PTTYPE,SERIAL,WWN,MAJ:MIN,RM,HOTPLUG,TRAN,MODEL,RO,LOG-SEC'])
    raw = json.loads(p.stdout)['blockdevices']
    mounts = mounts_all()
    with open('/proc/swaps') as f: swap_paths = [unescape(x.split()[0]) for x in list(f)[1:] if x.split()]
    swap_devices = set()
    for p in swap_paths:
        s = os.stat(p)
        swap_devices.add('%d:%d' % (os.major(s.st_rdev if stat.S_ISBLK(s.st_mode) else s.st_dev), os.minor(s.st_rdev if stat.S_ISBLK(s.st_mode) else s.st_dev)))
    byids = {}
    for name in sorted(os.listdir('/dev/disk/by-id')) if os.path.isdir('/dev/disk/by-id') else []:
        p = '/dev/disk/by-id/' + name
        if '-part' not in name: byids.setdefault(os.path.realpath(p), p)
    disks = []
    for n in raw:
        if n['type'] != 'disk': continue
        device = n['name']; kernel = os.path.basename(n['kname'])
        stable = byids.get(device)
        serial, wwn = n.get('serial') or '', n.get('wwn') or ''
        identity = {'device': device, 'serial': serial, 'wwn': wwn, 'majorMinor': n['maj:min'], 'size': int(n['size']), 'diskseq': read_sys('/sys/class/block/'+kernel+'/diskseq'), 'sysfs': os.path.realpath('/sys/class/block/'+kernel)}
        disk = {'id': digest({'stable': stable or device, 'serial': serial, 'wwn': wwn})[:24], 'device': device, 'byId': stable, 'serial': serial, 'wwn': wwn, 'name': (n.get('model') or kernel).strip(), 'size': int(n['size']), 'sectorSize': int(n.get('log-sec') or 512), 'table': n.get('pttype'), 'identity': identity, 'external': bool(n.get('rm') or n.get('hotplug') or n.get('tran')=='usb'), 'partitions': [], 'blockers': [], 'mounts': []}
        nodes = []
        def walk(node):
            nodes.append(node)
            for child in node.get('children', []): walk(child)
        walk(n)
        for node in nodes:
            k = os.path.basename(node['kname']); mm = node['maj:min']; current = mounts.get(mm, [])
            holders = sorted(os.listdir('/sys/class/block/'+k+'/holders'))
            disk['mounts'].extend(current)
            if holders or node['type'] not in ('disk', 'part') or node.get('fstype') in CONTAINERS:
                disk['blockers'].append('El disco contiene swap, cifrado, RAID, LVM u otro volumen administrado. No se modifica desde este asistente.')
            if mm in swap_devices: disk['blockers'].append('El disco está en uso como memoria swap.')
            if node.get('ro'): disk['blockers'].append('El dispositivo es de sólo lectura.')
            technical = (node.get('parttype') or '').lower() in TECHNICAL or any(re.match(r'^/(boot|efi)(/|$)', m['path']) for m in current)
            if technical or any(m['path']=='/' or re.match(r'^/(boot|efi|home|etc|var|usr|opt|srv)(/|$)', m['path']) for m in current):
                disk['blockers'].append('Disco del sistema o de un servicio: se protege contra borrado y cambios de particiones.')
            if node['type']=='part' or node is n and node.get('fstype'):
                start = int(read_sys('/sys/class/block/'+k+'/start') or 0)  # sysfs always uses 512-byte sectors
                number = int(read_sys('/sys/class/block/'+k+'/partition') or 0)
                disk['partitions'].append({'autoMount': any('# AXON-DISK '+str(node.get('uuid')) in line for line in open(FSTAB)), 'id': digest({'disk': disk['id'], 'partuuid': node.get('partuuid'), 'device': node['name']})[:24], 'number': number, 'device': node['name'], 'majorMinor': mm, 'diskseq': identity['diskseq'], 'size': int(node['size']), 'startBytes': start*512, 'filesystem': node.get('fstype'), 'name': node.get('label') or os.path.basename(node['name']), 'uuid': node.get('uuid'), 'partuuid': node.get('partuuid'), 'parttype': node.get('parttype'), 'mounts': current, 'technical': technical, 'readOnly': bool(node.get('ro'))})
        if not stable or not (serial or wwn) or not identity['diskseq']:
            disk['blockers'].append('Falta una identidad física estable (serie, by-id o diskseq). No se habilita el borrado.')
        with open(FSTAB) as f: fstab=f.read()
        disk['fstabRevision']=digest(fstab)
        references={device,stable or '',*['UUID='+p['uuid'] for p in disk['partitions'] if p['uuid']],*['PARTUUID='+p['partuuid'] for p in disk['partitions'] if p['partuuid']],*[p['device'] for p in disk['partitions']],*['LABEL='+p['name'] for p in disk['partitions']],*['/dev/disk/by-uuid/'+p['uuid'] for p in disk['partitions'] if p['uuid']],*['/dev/disk/by-partuuid/'+p['partuuid'] for p in disk['partitions'] if p['partuuid']]}
        for alias in os.listdir('/dev/disk/by-id') if os.path.isdir('/dev/disk/by-id') else []:
            aliaspath='/dev/disk/by-id/'+alias
            if os.path.realpath(aliaspath) in references: references.add(aliaspath)
        for line in fstab.splitlines():
            fields=line.split()
            if fields and not line.lstrip().startswith('#') and unescape(fields[0]) in references and '# AXON-DISK ' not in line:
                disk['blockers'].append('El disco está configurado fuera de AXON en el sistema. Se conservan sus ajustes; sólo se puede cambiar su visibilidad.')
        disk['blockers'] = list(dict.fromkeys(disk['blockers']))
        disk['revision'] = digest({k: disk[k] for k in ['identity','partitions','mounts','blockers','table','fstabRevision']})
        disk['appendableBytes']=max(0,disk['size']-max([p['startBytes']+p['size'] for p in disk['partitions']]+[0])-32*1024**2)
        disk['canEdit'] = not disk['blockers'] and not disk['mounts'] and os.geteuid()==0
        if disk['blockers']: disk['editReason'] = disk['blockers'][0]
        elif disk['mounts']: disk['editReason'] = 'Desmontá las particiones de datos antes de modificar el disco. Los volúmenes usados por servicios permanecen bloqueados.'
        elif os.geteuid()!=0: disk['editReason'] = 'AXON necesita su servicio privilegiado para configurar discos. En modo de desarrollo sólo se consulta.'
        else: disk['editReason'] = ''
        disks.append(disk)
    formats = [{**v, 'id': k, 'available': bool(shutil.which(v['tool']))} for k,v in FILESYSTEMS.items()]
    return {'ok': True, 'disks': disks, 'formats': formats, 'canPartition': all(shutil.which(t) for t in ('sfdisk','udevadm','blkid')), 'canAutoMount': all(shutil.which(t) for t in ('systemctl','systemd-escape')), 'privileged': os.geteuid()==0}

def disk_for(data, disk_id):
    matches = [d for d in data['disks'] if d['id']==disk_id]
    if len(matches)!=1: raise ValueError('El disco cambió o fue desconectado. Actualizá la lista.')
    return matches[0]

def label(value, filesystem):
    limit = 16 if filesystem=='ext4' else 15
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 _-]{0,%d}' % (limit-1),value):
        raise ValueError('Usá un nombre de hasta %d caracteres, con letras sin acentos, números, espacios, guion o guion bajo.' % limit)
    return value

def layout_rows(rows, capacity):
    if not isinstance(rows,list) or not 1<=len(rows)<=16: raise ValueError('Elegí entre 1 y 16 particiones.')
    out, total, remaining = [], 0, False
    for i,r in enumerate(rows):
        if not isinstance(r,dict) or set(r)-{'name','filesystem','sizeMiB'}: raise ValueError('Partición inválida.')
        fs = r.get('filesystem')
        if fs not in FILESYSTEMS: raise ValueError('Formato no permitido.')
        name = label(r.get('name'), fs)
        amount = r.get('sizeMiB')
        if amount is None:
            if remaining or i!=len(rows)-1: raise ValueError('Sólo la última partición puede usar el espacio restante.')
            remaining = True
        elif isinstance(amount,bool) or not isinstance(amount,int) or amount<64: raise ValueError('Cada partición debe tener al menos 64 MiB.')
        else: total += amount*1024**2
        out.append({'name':name,'filesystem':fs,'sizeMiB':amount})
    if len({r['name'].lower() for r in out})!=len(out): raise ValueError('Elegí nombres diferentes para las particiones.')
    if total+32*1024**2+(64*1024**2 if remaining else 0)>capacity: raise ValueError('Las particiones superan el espacio disponible; dejá lugar para la tabla y la alineación.')
    return out

def normalize(request, disk):
    action = request.get('operation')
    if action not in ('layout','format','append','delete','mount','unmount','configure'): raise ValueError('Operación no permitida.')
    part = next((p for p in disk['partitions'] if p['id']==request.get('partitionId')), None)
    if action!='layout' and action!='append' and not part: raise ValueError('Elegí una partición existente.')
    if action in ('layout','format','append','delete'):
        if not all(shutil.which(t) for t in ('udevadm','blkid','mount')): raise ValueError('Faltan herramientas de discos en el servidor; no se habilita el borrado.')
        if disk['blockers']: raise ValueError(disk['blockers'][0])
        if disk['mounts']: raise ValueError(disk['editReason'])
        if os.geteuid()!=0: raise ValueError('Se necesita el servicio privilegiado de AXON.')
    if action in ('layout','append','delete') and not shutil.which('sfdisk'): raise ValueError('Falta sfdisk en el servidor.')
    rows=[]
    if action in ('layout','append'):
        capacity = disk['size'] if action=='layout' else max(0,disk['size']-max([p['startBytes']+p['size'] for p in disk['partitions']]+[0]))
        if action=='append' and (disk['table']!='gpt' or any(not p['number'] for p in disk['partitions'])): raise ValueError('Agregar sin borrar requiere una tabla GPT existente.')
        rows=layout_rows(request.get('partitions'), capacity)
    elif action=='format': rows=layout_rows([{'name':request.get('name'),'filesystem':request.get('filesystem'),'sizeMiB':None}],part['size']+32*1024**2)
    for r in rows:
        if not shutil.which(FILESYSTEMS[r['filesystem']]['tool']): raise ValueError('Falta la herramienta para '+r['filesystem']+' en el servidor.')
    if action=='delete' and not part['number']: raise ValueError('Este volumen no tiene una partición independiente.')
    if action in ('mount','unmount','configure'):
        if os.geteuid()!=0: raise ValueError('Se necesita el servicio privilegiado de AXON.')
        if part['technical'] or any('sistema' in b or 'administrado' in b or 'fuera de AXON' in b for b in disk['blockers']): raise ValueError('Este disco está protegido. Sólo se puede cambiar su visibilidad.')
        if action=='mount' and (part['mounts'] or part['filesystem'] not in FILESYSTEMS): raise ValueError('La partición ya está montada o su formato no se admite en este asistente.')
        if action=='unmount':
            hostns=os.readlink('/proc/self/ns/mnt')
            hostmounts=[m for m in part['mounts'] if m['namespace']==hostns]
            if len(hostmounts)!=1 or hostmounts[0]['root']!='/' or not re.match(r'^/(mnt|media|run/media)/',hostmounts[0]['path']):
                raise ValueError('Sólo se desmonta una partición de datos sin montajes adicionales de servicios.')
            target=hostmounts[0]['path']
            if any(m['root']!='/' or m['path'] not in (target,'/hostfs'+target,'/mnt/host'+target) for m in part['mounts']):
                raise ValueError('La partición tiene un montaje adicional de un servicio. No se desmonta automáticamente.')
    auto=request.get('autoMount',False)
    if not isinstance(auto,bool): raise ValueError('Montaje automático inválido.')
    if auto and not all(shutil.which(t) for t in ('systemctl','systemd-escape')): raise ValueError('El montaje automático requiere systemd en el servidor.')
    return {'operation':action,'partitionId':part['id'] if part else None,'partitions':rows,'autoMount':auto}

def safe_state():
    if os.geteuid()!=0: raise ValueError('Se necesita el servicio privilegiado de AXON.')
    for p in ['/var/lib/axon',STATE]:
        os.makedirs(p, mode=0o700, exist_ok=True)
        s=os.lstat(p)
        if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022: raise ValueError('El registro de operaciones no es seguro.')

def save(op):
    p=STATE+'/'+op['id']+'.json';temp=p+'.'+uuid.uuid4().hex+'.tmp'
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as f: json.dump(op,f);f.flush();os.fsync(f.fileno())
    os.replace(temp,p)
    fd=os.open(STATE,os.O_RDONLY|os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def load(op_id):
    if not isinstance(op_id,str) or not re.fullmatch(r'[a-f0-9]{32}',op_id): raise ValueError('Operación inválida.')
    fd=os.open(STATE+'/'+op_id+'.json',os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd) as f: return json.load(f)

def public(op):
    return {k:v for k,v in op.items() if k not in ('actor','identity','revision','pid','processStart','configurationBackups','user')}

@contextlib.contextmanager
def locked():
    safe_state()
    fd=os.open(STATE+'/lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        try: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise ValueError('Hay otra operación de discos en curso. Esperá a que termine.')
        yield fd
    finally: os.close(fd)

def owner(op,request):
    if op['actor']!=request.get('actor'): raise ValueError('La operación pertenece a otra sesión. Prepará una nueva revisión.')

def plan(request):
    with locked():
        disk=disk_for(inventory(),request.get('diskId'))
        spec=normalize(request,disk)
        user=pwd.getpwnam(request['user'])
        if user.pw_uid==0: raise ValueError('Configurá una cuenta no privilegiada para los archivos de AXON.')
        op={'id':uuid.uuid4().hex,'state':'planned','createdAt':time.time(),'expiresAt':time.time()+600,'actor':request['actor'],'diskId':disk['id'],'diskName':disk['name'],'device':disk['device'],'serial':disk['serial'] or disk['wwn'],'identity':disk['identity'],'revision':disk['revision'],'spec':spec,'user':user.pw_name,'steps':[],'message':'Revisión preparada. No se modificó el disco.','confirmation':'BORRAR '+(disk['serial'] or disk['wwn']) if spec['operation'] in ('layout','format','delete') else 'CONFIRMAR'}
        op['digest']=digest(op);save(op)
        return {'ok':True,'plan':public(op)}

def process_start(pid):
    try: return open('/proc/%d/stat'%pid).read().rsplit(')',1)[1].split()[19]
    except (OSError,IndexError): return None

def pinned(device, expected, exclusive=False, read_only=False, expected_seq=None):
    fd=os.open(device,(os.O_RDONLY if read_only else os.O_RDWR)|(os.O_EXCL if exclusive else 0)|os.O_NOFOLLOW)
    s=os.fstat(fd)
    if not stat.S_ISBLK(s.st_mode) or '%d:%d'%(os.major(s.st_rdev),os.minor(s.st_rdev))!=expected:
        os.close(fd);raise ValueError('La identidad del dispositivo cambió.')
    if expected_seq is not None:
        actual=struct.unpack('Q',fcntl.ioctl(fd,0x80081280,bytes(8)))[0]  # BLKGETDISKSEQ
        if str(actual)!=str(expected_seq):
            os.close(fd);raise ValueError('La identidad física del dispositivo cambió.')
    return fd

def same_disk(op):
    d=disk_for(inventory(),op['diskId'])
    if d['identity']!=op['identity']: raise ValueError('El disco se desconectó o fue sustituido. Se detuvo la operación.')
    return d

def step(op, message):
    op['message']=message;op['steps'].append({'at':time.time(),'message':message});save(op)

def mount_partition(part, user):
    account=pwd.getpwnam(user)
    if account.pw_uid==0: raise ValueError('El usuario de archivos no puede ser root.')
    if not part.get('uuid') or part['filesystem'] not in FILESYSTEMS: raise ValueError('No se confirmó el formato de la partición.')
    target='/mnt/axon-disks/'+hashlib.sha256(part['uuid'].encode()).hexdigest()[:16]
    for p in ['/mnt/axon-disks',target]:
        os.makedirs(p,mode=0o755,exist_ok=True)
        s=os.lstat(p)
        if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022: raise ValueError('El directorio de montaje no es seguro.')
    flags='nosuid,nodev'
    if part['filesystem']=='exfat': flags+=',uid=%d,gid=%d,umask=0022'%(account.pw_uid,account.pw_gid)
    fd=pinned(part['device'],part['majorMinor'],exclusive=False,read_only=True,expected_seq=part['diskseq'])
    try: run(['mount','-t',part['filesystem'],'-o',flags,'/proc/self/fd/%d'%fd,target],fds=(fd,))
    finally: os.close(fd)
    if part['filesystem']=='ext4':
        # Only called for a newly created filesystem; existing disks keep owners.
        return target
    return target

def automount(part, user, enabled, op):
    filesystem=part.get('filesystem');identifier=part.get('uuid')
    if not identifier or filesystem not in FILESYSTEMS:
        if enabled: raise ValueError('No se confirmó el formato para el montaje automático.')
        return
    if not re.fullmatch(r'[A-Za-z0-9-]+',identifier): raise ValueError('UUID inválido.')
    marker='# AXON-DISK '+identifier
    with open(FSTAB) as f: original=f.read()
    lines=original.splitlines()
    matches=[l for l in lines if l.split() and not l.lstrip().startswith('#') and l.split()[0]=='UUID='+identifier]
    if any(marker not in l for l in matches): raise ValueError('La partición tiene una configuración externa; se conserva sin cambios.')
    if not enabled and not matches: return
    target='/mnt/axon-disks/'+hashlib.sha256(identifier.encode()).hexdigest()[:16]
    result=[l for l in lines if marker not in l]
    if enabled:
        # Persistent UUID identity, optional disk, access-trigger mount: neither
        # a missing USB disk nor a renamed /dev/sdX blocks the next boot.
        options='nosuid,nodev,nofail,x-systemd.automount,x-systemd.device-timeout=5s'
        if filesystem=='exfat':
            account=pwd.getpwnam(user);options+=',uid=%d,gid=%d,umask=0022'%(account.pw_uid,account.pw_gid)
        result.append('UUID=%s %s %s %s 0 %d %s'%(identifier,target,filesystem,options,2 if filesystem=='ext4' else 0,marker))
    updated='\n'.join(result)+'\n'
    if updated==original: return
    op.setdefault('configurationBackups',[]).append({'at':time.time(),'fstab':original});save(op)
    # Cooperate with other AXON operations and refuse unsafe links or changed
    # external edits. Never truncate or rewrite existing mount definitions.
    fd=os.open(FSTAB,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        st=os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_uid!=0: raise ValueError('La configuración de montajes no es segura.')
        with open(FSTAB) as f:
            if f.read()!=original: raise ValueError('Cambió la configuración de montajes. Volvé a revisar.')
        temp=os.path.join(os.path.dirname(FSTAB),'.axon-fstab-'+uuid.uuid4().hex)
        out=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,stat.S_IMODE(st.st_mode))
        with os.fdopen(out,'w') as f: f.write(updated);f.flush();os.fsync(f.fileno())
        latest=os.stat(FSTAB,follow_symlinks=False)
        with open(FSTAB) as f: unchanged=f.read()==original
        if (latest.st_dev,latest.st_ino,latest.st_mtime_ns,latest.st_size)!=(st.st_dev,st.st_ino,st.st_mtime_ns,st.st_size) or not unchanged:
            os.unlink(temp);raise ValueError('Cambió la configuración de montajes. Se conservó sin reemplazarla.')
        os.replace(temp,FSTAB)
        directory=os.open(os.path.dirname(FSTAB),os.O_RDONLY|os.O_DIRECTORY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally: os.close(fd)
    run(['systemctl','daemon-reload'])
    # This only starts/removes AXON's access-trigger unit; no service restart.
    unit=run(['systemd-escape','--path','--suffix=automount',target]).stdout.strip()
    if not enabled: run(['systemctl','stop',unit],check=False)
    elif not any(m['path']==target for mounts in mounts_all().values() for m in mounts): run(['systemctl','start',unit])


def mkfs(part, row):
    # Builders open the pinned device themselves with O_EXCL. Holding our
    # own exclusive claim would make even an unused disk look busy.
    fd=pinned(part['device'],part['majorMinor'],exclusive=False,expected_seq=part['diskseq'])
    try:
        argv=['mkfs.ext4','-q','-L',row['name']] if row['filesystem']=='ext4' else ['mkfs.exfat','-L',row['name']]
        run(argv+['/proc/self/fd/%d'%fd],input='y\n' if row['filesystem']=='ext4' else None,timeout=300,fds=(fd,))
        os.fsync(fd)
    finally: os.close(fd)

def partition_script(rows):
    return '\n'.join(('size=%dMiB, '%r['sizeMiB'] if r['sizeMiB'] is not None else '')+'type='+FILESYSTEMS[r['filesystem']]['type']+', name="'+r['name']+'"' for r in rows)+'\n'

def worker(op):
    try:
        disk=same_disk(op)
        if disk['revision']!=op['revision']: raise ValueError('Cambió el estado del disco desde la revisión. No se realizaron cambios.')
        normalize({**op['spec'],'diskId':disk['id'],'name':op['spec']['partitions'][0]['name'] if op['spec']['partitions'] else None,'filesystem':op['spec']['partitions'][0]['filesystem'] if op['spec']['partitions'] else None},disk)
        action=op['spec']['operation'];rows=op['spec']['partitions'];selected=next((p for p in disk['partitions'] if p['id']==op['spec']['partitionId']),None)
        if action=='unmount':
            step(op,'Desmontando la partición de datos…')
            hostmount=next(m for m in selected['mounts'] if m['namespace']==os.readlink('/proc/self/ns/mnt'))
            if selected.get('autoMount'):
                unit=run(['systemd-escape','--path','--suffix=automount',hostmount['path']]).stdout.strip()
                run(['systemctl','stop',unit])
            run(['umount','--',hostmount['path']])
            if next(p for p in same_disk(op)['partitions'] if p['id']==selected['id'])['mounts']: raise ValueError('No se confirmó el desmontaje.')
        elif action=='configure':
            if selected['filesystem'] not in FILESYSTEMS or not selected.get('uuid'): raise ValueError('El formato de esta partición no admite configuración automática.')
            step(op,'Configurando disponibilidad después de reiniciar…');automount(selected,op['user'],op['spec']['autoMount'],op)
        elif action=='mount':
            step(op,'Montando la partición…');target=mount_partition(selected,op['user']);op['paths']=[target]
            if op['spec']['autoMount']: automount(selected,op['user'],True,op)
            if not any(m['path']==target for p in same_disk(op)['partitions'] if p['id']==selected['id'] for m in p['mounts']): raise ValueError('No se confirmó el montaje.')
        else:
            targets=[]
            retired=disk['partitions'] if action=='layout' else ([selected] if action in ('format','delete') else [])
            for part in retired: automount(part,op['user'],False,op)
            if action in ('layout','append','delete'):
                step(op,'Preparando la tabla de particiones…')
                # Save metadata for diagnosis, not a promise to recover erased files.
                dump=run(['sfdisk','--dump',disk['byId']],check=False)
                op['previousTable']=dump.stdout[:30000];save(op)
                disk=same_disk(op)
                if disk['mounts'] or disk['blockers']: raise ValueError('El disco está ocupado o cambió. No se escribió la tabla.')
                fd=pinned(disk['device'],disk['identity']['majorMinor'],exclusive=False,expected_seq=disk['identity']['diskseq'])
                try:
                    argv=['sfdisk','--lock=yes','--wipe','always','--wipe-partitions','always'] if action=='layout' else ['sfdisk','--lock=yes','--wipe','never','--wipe-partitions','never']
                    text=('label: gpt\n'+partition_script(rows)) if action=='layout' else partition_script(rows)
                    if action=='append': argv+=['--append']
                    if action=='delete': argv+=['--delete'];text=None
                    argv+=['/proc/self/fd/%d'%fd]
                    if action=='delete': argv+=[str(selected['number'])]
                    run(argv,input=text,fds=(fd,),timeout=60);os.fsync(fd)
                finally: os.close(fd)
                run(['udevadm','settle','--timeout=10'],timeout=15)
                current=same_disk(op)
                if action in ('append','delete'):
                    old=[p for p in disk['partitions'] if action!='delete' or p['id']!=selected['id']]
                    for p in old:
                        observed=next((q for q in current['partitions'] if q['partuuid']==p['partuuid']),None)
                        if not observed or any(observed[k]!=p[k] for k in ('number','startBytes','size','uuid','filesystem')): raise ValueError('Cambió una partición que debía conservarse. No se inició el formateo.')
                if current['mounts'] or current['blockers']: raise ValueError('El disco pasó a estar ocupado después de crear las particiones; se detuvo el formateo.')
                if action=='layout': targets=sorted(current['partitions'],key=lambda p:p['number'])
                elif action=='append': targets=[p for p in sorted(current['partitions'],key=lambda p:p['number']) if p['partuuid'] not in {p['partuuid'] for p in disk['partitions']}]
                else:
                    if any(p['partuuid']==selected['partuuid'] for p in current['partitions']): raise ValueError('No se confirmó la eliminación de la partición.')
                if action!='delete' and len(targets)!=len(rows): raise ValueError('No se confirmó la distribución de particiones. No se inició el formateo.')
            else: targets=[selected]
            formatted=[]
            for part,row in zip(targets,rows):
                fresh=same_disk(op)
                if fresh['mounts'] or fresh['blockers']: raise ValueError('El disco está ocupado. Se detuvo el formateo.')
                observed=next((p for p in fresh['partitions'] if p['device']==part['device'] and p['partuuid']==part['partuuid'] and p['majorMinor']==part['majorMinor']),None)
                if not observed: raise ValueError('La partición cambió. Se detuvo el formateo.')
                step(op,'Formateando '+row['name']+' como '+row['filesystem']+'…');mkfs(observed,row)
                run(['udevadm','trigger','--action=change','--sysname-match='+os.path.basename(observed['device'])])
                run(['udevadm','settle','--timeout=10'],timeout=15)
                # Probe disk bytes, not potentially stale udev filesystem metadata.
                probe=run(['blkid','-p','-o','export',observed['device']]).stdout
                metadata=dict(x.split('=',1) for x in probe.splitlines() if '=' in x)
                if metadata.get('TYPE')!=row['filesystem'] or metadata.get('LABEL')!=row['name'] or not metadata.get('UUID'): raise ValueError('No se confirmó el formato nuevo. Revisá el disco.')
                fresh=same_disk(op)
                observed=next(p for p in fresh['partitions'] if p['partuuid']==observed['partuuid'] and p['device']==observed['device'])
                observed.update(filesystem=row['filesystem'],uuid=metadata['UUID'],name=row['name']);formatted.append(observed)
                op.setdefault('formatted',[]).append({'name':row['name'],'filesystem':row['filesystem'],'uuid':metadata['UUID'],'device':observed['device']});save(op)
            op['paths']=[]
            for part in formatted:
                step(op,'Dejando disponible '+part['name']+'…')
                fresh=same_disk(op)
                if any(p['mounts'] for p in fresh['partitions'] if p['device']==part['device']): raise ValueError('Otro servicio montó la partición. No se cambiaron sus permisos.')
                target=mount_partition(part,op['user'])
                if part['filesystem']=='ext4':
                    fd=os.open(target,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
                    try:
                        s=os.fstat(fd)
                        if '%d:%d'%(os.major(s.st_dev),os.minor(s.st_dev))!=part['majorMinor']: raise ValueError('Cambió el montaje. No se ajustaron los permisos.')
                        account=pwd.getpwnam(op['user']);os.fchown(fd,account.pw_uid,account.pw_gid)
                    finally: os.close(fd)
                confirmed=same_disk(op)
                if not any(m['path']==target for p in confirmed['partitions'] if p['device']==part['device'] for m in p['mounts']): raise ValueError('No se confirmó el acceso a la partición.')
                if op['spec']['autoMount']: automount(part,op['user'],True,op)
                op['paths'].append(target);save(op)
        op['state']='verified';op['message']='Operación completada y verificada.';op['finishedAt']=time.time();save(op)
    except Exception as e:
        op['state']='failed';op['message']=str(e) if isinstance(e,ValueError) else 'La operación se interrumpió. Revisá las particiones y los pasos registrados; no vuelvas a ejecutarla automáticamente.';op['finishedAt']=time.time();save(op)

def start(request):
    with locked() as lockfd:
        op=load(request.get('id'));owner(op,request)
        if op['state']!='planned': raise ValueError('Esta revisión ya fue utilizada. Comprobá el resultado en el historial.')
        if op['expiresAt']<time.time() or op['digest']!=request.get('digest'): raise ValueError('La revisión venció o cambió. Prepará una nueva.')
        if request.get('confirmation')!=op['confirmation']: raise ValueError('La confirmación no coincide con el disco seleccionado.')
        disk=same_disk(op)
        if disk['revision']!=op['revision']: raise ValueError('El disco cambió desde la revisión. Prepará una nueva.')
        op['state']='running';op['message']='Iniciando la operación…';save(op)
        # Fork retains the directory lock. Returning/losing the HTTP connection
        # never kills or retries a destructive host command.
        pid=os.fork()
        if pid==0:
            try:
                os.setsid()
                null=os.open('/dev/null',os.O_RDWR)
                for fd in (0,1,2): os.dup2(null,fd)
                os.close(null)
                op['pid']=os.getpid();op['processStart']=process_start(os.getpid());save(op);worker(op)
            finally: os._exit(0)
        return {'ok':True,'operation':public(op)}

def status(request):
    safe_state();op=load(request.get('id'))
    if op['actor'].split(':',1)[0]!=request['actor'].split(':',1)[0]: raise ValueError('Operación de otra cuenta.')
    if op['state']=='running' and ((op.get('pid') and process_start(op['pid'])!=op.get('processStart')) or (not op.get('pid') and time.time()-op['createdAt']>15)):
        with locked():
            op=load(op['id'])
            if op['state']=='running': op['state']='interrupted';op['message']='El proceso se interrumpió. El disco puede haber cambiado parcialmente. Revisá los pasos; no se reanuda ni se repite automáticamente.';save(op)
    return {'ok':True,'operation':public(op)}

def main(request):
    if request.get('action')=='inventory': return inventory()
    if request.get('action')=='plan': return plan(request)
    if request.get('action')=='start': return start(request)
    if request.get('action')=='status': return status(request)
    if request.get('action')=='history':
        safe_state();ops=[]
        for f in sorted(os.listdir(STATE),reverse=True):
            if re.fullmatch(r'[a-f0-9]{32}\.json',f):
                op=load(f[:-5])
                if op['actor'].split(':',1)[0]==request['actor'].split(':',1)[0]: ops.append(status({**request,'id':op['id']})['operation'])
        return {'ok':True,'operations':sorted(ops,key=lambda o:o['createdAt'],reverse=True)[:50]}
    raise ValueError('Operación no permitida.')

if __name__=='__main__':
    try:
        request=json.loads(sys.stdin.read(64000))
        print(json.dumps(main(request)))
    except Exception as e:
        print(json.dumps({'ok':False,'error':str(e) if isinstance(e,ValueError) else 'No se pudo consultar o configurar el disco. Revisá los permisos y el historial.'}))

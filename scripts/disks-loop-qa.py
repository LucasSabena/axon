"""Optional root-only kernel QA in a private mount namespace.
Only writes a newly created sparse image. Never accepts a caller device/path.
"""
import importlib.util, json, os, pathlib, shutil, stat, subprocess, tempfile
spec=importlib.util.spec_from_file_location('disk_helper',pathlib.Path(__file__).resolve().parent.parent/'src/storage/disks-host.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
original_run=m.run
def detailed_run(argv, **kw):
    kw['check']=False
    r=original_run(argv,**kw)
    if r.returncode: raise RuntimeError(str(argv[:3])+': '+r.stderr+r.stdout)
    return r
m.run=detailed_run
if os.geteuid()!=0: raise SystemExit('Run this dedicated fixture with sudo unshare --mount --propagation private.')

def command(args,**opts):
    return subprocess.run(args,check=True,text=True,capture_output=True,**opts).stdout.strip()
with tempfile.TemporaryDirectory(prefix='axon-disk-loop-qa-') as directory:
    root=pathlib.Path(directory);image=root/'owned-disk.img';device=None;mounted=False
    with image.open('wb') as f:f.truncate(512*2**20)
    try:
        device=command(['losetup','--find','--show','--partscan',str(image)])
        def verify():
            info=json.loads(command(['losetup','--json','--output','NAME,BACK-FILE',device]))['loopdevices']
            if len(info)!=1 or pathlib.Path(info[0]['back-file']).resolve()!=image.resolve(): raise RuntimeError('Fixture ownership changed; refusing device operations.')
        command(['udevadm','settle','--timeout=10']);verify();s=os.stat(device);major='%d:%d'%(os.major(s.st_rdev),os.minor(s.st_rdev))
        fd=m.pinned(device,major,exclusive=False)
        rows=[{'name':'QA_DATOS','filesystem':'ext4','sizeMiB':128},{'name':'QA_EXFAT','filesystem':'exfat','sizeMiB':128}]
        try:
            result=m.run(['sfdisk','--lock=yes','--wipe','always','--wipe-partitions','always','/proc/self/fd/%d'%fd],input='label: gpt\n'+m.partition_script(rows),fds=(fd,),check=False)
            if result.returncode:raise RuntimeError('sfdisk pinned descriptor: '+result.stderr)
        finally:os.close(fd)
        command(['udevadm','settle','--timeout=10']);verify()
        parts=json.loads(command(['lsblk','--json','--paths','--output','NAME,TYPE,MAJ:MIN',device]))['blockdevices'][0]['children']
        if len(parts)!=2:raise RuntimeError('Unexpected fixture partitions')
        for part,row in zip(parts,rows):
            verify();m.mkfs({'device':part['name'],'majorMinor':part['maj:min'],'diskseq':m.read_sys('/sys/class/block/'+os.path.basename(device)+'/diskseq')},row)
            probe=command(['blkid','-p','-o','export',part['name']])
            if 'TYPE='+row['filesystem'] not in probe or 'LABEL='+row['name'] not in probe:raise RuntimeError('Filesystem verification failed')
        verify();m.mkfs({'device':parts[0]['name'],'majorMinor':parts[0]['maj:min'],'diskseq':m.read_sys('/sys/class/block/'+os.path.basename(device)+'/diskseq')},{'name':'QA_REFORMAT','filesystem':'ext4'})
        if 'LABEL=QA_REFORMAT' not in command(['blkid','-p','-o','export',parts[0]['name']]):raise RuntimeError('Existing filesystem reformat failed')
        target=root/'mount';target.mkdir();part=parts[0];fd=m.pinned(part['name'],part['maj:min'],exclusive=False,read_only=True)
        try:
            result=m.run(['mount','-t','ext4','-o','nosuid,nodev','/proc/self/fd/%d'%fd,str(target)],fds=(fd,),check=False)
            if result.returncode:raise RuntimeError('mount pinned descriptor: '+result.stderr)
            mounted=True
        finally:os.close(fd)
        (target/'receipt.txt').write_text('Owned loop fixture only.\n')
        # Native builders and sfdisk must also refuse a mounted fixture even if
        # a mount races the higher-level inventory checks.
        verify()
        busy=m.pinned(parts[0]['name'],parts[0]['maj:min'],exclusive=False)
        try:
            denied=original_run(['mkfs.ext4','-q','-L','SHOULD_NOT_WRITE','/proc/self/fd/%d'%busy],input='y\n',fds=(busy,),check=False)
            if denied.returncode==0:raise RuntimeError('Mounted filesystem was formatted')
        finally:os.close(busy)
        verify();busy=m.pinned(device,major,exclusive=False)
        try:
            denied=original_run(['sfdisk','--lock=yes','--append','/proc/self/fd/%d'%busy],input=m.partition_script([{'name':'SHOULD_NOT_WRITE','filesystem':'ext4','sizeMiB':64}]),fds=(busy,),check=False)
            if denied.returncode==0:raise RuntimeError('Mounted disk was repartitioned')
        finally:os.close(busy)
        if (target/'receipt.txt').read_text()!='Owned loop fixture only.\n':raise RuntimeError('Busy checks changed content')
        command(['umount','--',str(target)]);mounted=False
        verify();before=json.loads(command(['sfdisk','--json',device]))['partitiontable']['partitions']
        fd=m.pinned(device,major,exclusive=False)
        try:m.run(['sfdisk','--lock=yes','--wipe','never','--wipe-partitions','never','--append','/proc/self/fd/%d'%fd],input=m.partition_script([{'name':'QA_EXTRA','filesystem':'ext4','sizeMiB':64}]),fds=(fd,))
        finally:os.close(fd)
        command(['udevadm','settle','--timeout=10']);after=json.loads(command(['sfdisk','--json',device]))['partitiontable']['partitions']
        if before!=after[:2] or len(after)!=3:raise RuntimeError('Append changed existing partitions')
        verify();fd=m.pinned(device,major,exclusive=False)
        try:m.run(['sfdisk','--lock=yes','--wipe','never','--wipe-partitions','never','--delete','/proc/self/fd/%d'%fd,'3'],fds=(fd,))
        finally:os.close(fd)
        if before!=json.loads(command(['sfdisk','--json',device]))['partitiontable']['partitions']:raise RuntimeError('Delete changed other partitions')
        command(['mount','-t','ext4','-o','nosuid,nodev',parts[0]['name'],str(target)]);mounted=True
        if (target/'receipt.txt').read_text()!='Owned loop fixture only.\n':raise RuntimeError('Partition operations changed existing files')
        command(['umount','--',str(target)]);mounted=False
        print(json.dumps({'ok':True,'checks':['GPT two partitions through pinned descriptor','ext4 and exFAT verified from disk bytes','existing ext4 reformat','mount and write in private namespace','kernel rejects mounted format and repartition','append and delete preserve other partitions and files'],'physicalDisksModified':False}))
    finally:
        if mounted:command(['umount','--',str(root/'mount')])
        if device:
            verify();command(['losetup','--detach',device])

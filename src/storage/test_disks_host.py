"""Safety regressions. No test writes a real block device or system configuration."""
import contextlib, copy, importlib.util, json, os, shutil, subprocess, tempfile, unittest
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path

spec=importlib.util.spec_from_file_location('disks_host',Path(__file__).with_name('disks-host.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class DiskSafety(unittest.TestCase):
    def setUp(self):
        self.disk={'id':'disk','identity':{'serial':'SERIAL','diskseq':'1'},'revision':'fresh','size':10*2**30,'table':'gpt','blockers':[],'mounts':[],'partitions':[{'id':'part','number':1,'size':2**30,'startBytes':2**20,'filesystem':'ext4','uuid':'old','partuuid':'partuuid','device':'/dev/fake1','technical':False,'mounts':[]}]}
    def normalize(self,request,disk=None):
        with patch.object(m.os,'geteuid',return_value=0),patch.object(m.shutil,'which',return_value='/test/tool'):
            return m.normalize(request,disk or self.disk)
    def test_capacity_alignment_and_remaining(self):
        rows=[{'name':'DATOS','filesystem':'ext4','sizeMiB':1024},{'name':'BACKUPS','filesystem':'ext4','sizeMiB':None}]
        self.assertEqual(m.layout_rows(rows,3*2**30),rows)
        for bad in [[],[rows[1],rows[0]],[rows[0],rows[0]],[{'name':'X','filesystem':'ext4','sizeMiB':True}],[{'name':'X','filesystem':'ext4','sizeMiB':63}],[{'name':'X','filesystem':'ext4','sizeMiB':3000}]]:
            with self.assertRaises(ValueError):m.layout_rows(bad,2*2**30)
    def test_injection_filesystem_and_unknown_fields(self):
        for row in [{'name':'x"\n/dev/sda','filesystem':'ext4','sizeMiB':64},{'name':'x','filesystem':'ntfs;rm','sizeMiB':64},{'name':'x','filesystem':'ext4','sizeMiB':64,'start':0}]:
            with self.assertRaises(ValueError):m.layout_rows([row],2**30)
    def test_system_holders_and_mounts_block_all_destructive_actions(self):
        for condition in [{'blockers':['Disco del sistema protegido']},{'blockers':['LVM administrado']},{'mounts':[{'path':'/data'}],'editReason':'Ocupado'}]:
            d={**self.disk,**condition}
            for action in ['layout','format','append','delete']:
                with self.assertRaises(ValueError):self.normalize({'operation':action,'partitionId':'part','filesystem':'ext4','name':'DATOS','partitions':[{'name':'DATOS','filesystem':'ext4','sizeMiB':None}]},d)
    def test_partition_selection_and_missing_tool(self):
        with self.assertRaises(ValueError):self.normalize({'operation':'format','partitionId':'other','name':'X','filesystem':'ext4'})
        with patch.object(m.os,'geteuid',return_value=0),patch.object(m.shutil,'which',return_value=None):
            with self.assertRaises(ValueError):m.normalize({'operation':'format','partitionId':'part','name':'X','filesystem':'exfat'},self.disk)
    def test_unmount_never_accepts_system_or_multiple_namespaces(self):
        for mounts in [[{'path':'/home','namespace':'host','root':'/'}],[{'path':'/mnt/data','namespace':'host','root':'/'},{'path':'/app','namespace':'container','root':'/'}]]:
            d=copy.deepcopy(self.disk);d['partitions'][0]['mounts']=mounts
            with self.assertRaises(ValueError):self.normalize({'operation':'unmount','partitionId':'part'},d)
    def test_append_requires_gpt(self):
        with self.assertRaises(ValueError):self.normalize({'operation':'append','partitions':[{'name':'X','filesystem':'ext4','sizeMiB':None}]},{**self.disk,'table':'dos'})
    def test_replacement_same_serial_different_diskseq_rejected(self):
        with patch.object(m,'inventory',return_value={'disks':[self.disk]}):
            with self.assertRaises(ValueError):m.same_disk({'diskId':'disk','identity':{'serial':'SERIAL','diskseq':'2'}})
    def test_busy_or_changed_revision_never_invokes_mutating_command(self):
        op={'id':'test','state':'running','diskId':'disk','identity':self.disk['identity'],'revision':'old','steps':[]}
        with patch.object(m,'inventory',return_value={'disks':[self.disk]}),patch.object(m,'save') as save,patch.object(m,'run') as run:
            m.worker(op);self.assertEqual(op['state'],'failed');run.assert_not_called();save.assert_called()
    def test_invalid_confirmation_expiration_replay_and_session(self):
        @contextlib.contextmanager
        def lock():yield 1
        base={'id':'1'*32,'actor':'user:session','state':'planned','expiresAt':m.time.time()+600,'digest':'digest','confirmation':'BORRAR SERIAL'}
        req={'id':base['id'],'actor':'user:session','digest':'digest','confirmation':'BORRAR SERIAL'}
        cases=[({**base,'state':'verified'},req),({**base,'expiresAt':0},req),(base,{**req,'confirmation':'CONFIRMAR'}),(base,{**req,'digest':'wrong'}),(base,{**req,'actor':'user:different-session'})]
        for op,r in cases:
            with patch.object(m,'locked',lock),patch.object(m,'load',return_value=op),patch.object(m.os,'fork') as fork:
                with self.assertRaises(ValueError):m.start(r)
                fork.assert_not_called()
    def test_public_receipt_does_not_expose_fstab_backup_or_session(self):
        self.assertEqual(m.public({'id':'test','actor':'secret','configurationBackups':['password=secret'],'user':'account','identity':{},'pid':1}),{'id':'test'})
    def test_regular_files_cannot_be_used_as_real_disks(self):
        with tempfile.NamedTemporaryFile() as f:
            with self.assertRaises(ValueError):m.pinned(f.name,'8:0')
    def test_automount_preserves_external_configuration_and_uses_uuid_nofail(self):
        with tempfile.TemporaryDirectory(prefix='axon-fstab-test-') as directory:
            fstab=Path(directory)/'fstab';original='# Original configuration\nUUID=system / ext4 defaults 0 1\n'
            fstab.write_text(original);state=Path(directory)/'state';state.mkdir()
            part={'filesystem':'ext4','uuid':'qa-only-uuid'};op={'id':'2'*32,'state':'running'}
            real_fstat=m.os.fstat
            def owned(fd):
                s=real_fstat(fd)
                return SimpleNamespace(st_mode=s.st_mode,st_uid=0,st_dev=s.st_dev,st_ino=s.st_ino,st_mtime_ns=s.st_mtime_ns,st_size=s.st_size)
            def fake_run(argv,**opts):
                return SimpleNamespace(stdout='test.automount\n',returncode=0)
            with patch.object(m,'FSTAB',str(fstab)),patch.object(m,'STATE',str(state)),patch.object(m.os,'fstat',side_effect=owned),patch.object(m,'run',side_effect=fake_run) as commands,patch.object(m,'mounts_all',return_value={}):
                m.automount(part,'root',True,op)  # ext4 does not use account ids
                result=fstab.read_text();self.assertTrue(result.startswith(original))
                self.assertIn('UUID=qa-only-uuid /mnt/axon-disks/',result);self.assertIn('nofail,x-systemd.automount',result)
                self.assertEqual(result.count('# AXON-DISK qa-only-uuid'),1)
                m.automount(part,'root',True,op);self.assertEqual(fstab.read_text(),result)
                m.automount(part,'root',False,op);self.assertEqual(fstab.read_text(),original)
                self.assertNotIn('configurationBackups',m.public(op));self.assertTrue(commands.called)
    def test_automount_refuses_foreign_uuid_entry_without_overwriting(self):
        with tempfile.TemporaryDirectory(prefix='axon-fstab-test-') as directory:
            fstab=Path(directory)/'fstab';original='UUID=qa-only-uuid /data ext4 defaults 0 2\n';fstab.write_text(original)
            with patch.object(m,'FSTAB',str(fstab)),patch.object(m,'run') as commands:
                with self.assertRaises(ValueError):m.automount({'filesystem':'ext4','uuid':'qa-only-uuid'},'root',True,{'id':'test'})
                commands.assert_not_called();self.assertEqual(fstab.read_text(),original)
    @unittest.skipUnless(shutil.which('sfdisk'),'requires sfdisk')
    def test_real_sfdisk_accepts_generated_layout_without_writing_image(self):
        with tempfile.TemporaryDirectory(prefix='axon-partition-test-') as d:
            image=Path(d)/'disk.img'
            with image.open('wb') as f:f.truncate(256*2**20)
            before=image.stat().st_mtime_ns
            fd=os.open(image,os.O_RDWR)
            try:
                rows=[{'name':'DATOS','filesystem':'ext4','sizeMiB':64},{'name':'COMPARTIR','filesystem':'exfat','sizeMiB':None}]
                result=m.run(['sfdisk','--no-act','--lock=nonblock','/proc/self/fd/%d'%fd],input='label: gpt\n'+m.partition_script(rows),fds=(fd,))
            finally:os.close(fd)
            self.assertEqual(result.returncode,0);self.assertEqual(before,image.stat().st_mtime_ns)
            with image.open('rb') as f:self.assertEqual(f.read(4096),bytes(4096))

if __name__=='__main__':unittest.main()

import errno
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('usb_host', Path(__file__).with_name('usb-host.py'))
usb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(usb)

class UsbTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.sys, self.proc, self.dev = [self.base / s for s in ('sys','proc','dev')]
        for p in [self.sys/'bus/usb/devices',self.sys/'class/block',self.proc/'self',self.dev]:
            p.mkdir(parents=True)
        self.put(self.sys/'class/dmi/id/product_name','Predator PT315-53')
        self.put(self.sys/'class/dmi/id/bios_version','V1.14')
        self.put(self.proc/'self/mountinfo','')
        self.put(self.proc/'swaps','Filename Type Size Used Priority\n')
        self.p = self.port('usb3',3)
        self.q = self.port('usb4',1)
        (self.p/'peer').symlink_to(self.q)
        (self.q/'peer').symlink_to(self.p)
        self.c = usb.UsbController(self.sys,self.base/'state/leases.json',self.proc,self.dev)

    def tearDown(self):
        self.temp.cleanup()

    def put(self,p,value):
        p.parent.mkdir(parents=True,exist_ok=True)
        p.write_text(value)

    def port(self,hub,n,kind='hotplug',location='0x0'):
        p=self.sys/'bus/usb/devices'/hub/(hub[3:]+'-0:1.0')/(hub+'-port'+str(n))
        for key,v in [('disable','0'),('connect_type',kind),('location',location),('state','not attached')]:
            self.put(p/key,v)
        self.put(p.parent.parent/'serial','controller-'+hub)
        return p

    def request(self,operation='cycle'):
        p=next(p for p in self.c.inventory()['ports'] if p['id']=='usb3-port3')
        return {'id':p['id'],'token':p['token'],'operation':operation,'seconds':15}

    def run_job(self,request):
        self.c.job={'port':request['id'],'state':'queued','restoreRequested':False,'error':''}
        now=[100]
        def clock():
            now[0]+=1
            return now[0]
        self.c.clock=clock
        with patch.object(usb.time,'sleep'):
            self.c.execute(request)

    def test_pairs_channels_and_restores_both(self):
        p=self.c.inventory()['ports'][0]
        self.assertEqual(p['ports'],['usb3-port3','usb4-port1'])
        self.run_job(self.request())
        self.assertEqual(self.c.job['state'],'completed')
        self.assertEqual((self.p/'disable').read_text(),'0')
        self.assertEqual((self.q/'disable').read_text(),'0')
        self.assertEqual(json.loads(self.c.journal.read_text()),{})

    def test_pairs_usb_c_across_controllers_for_validated_firmware(self):
        self.port('usb2',1,location='0x80000002')
        self.port('usb3',1,location='0x80000002')
        p=next(p for p in self.c.inventory()['ports'] if p['id']=='usb2-port1')
        self.assertEqual(p['ports'],['usb2-port1','usb3-port1'])

    def test_internal_and_unknown_ports_are_protected(self):
        self.port('usb3',9,'hardwired')
        p=next(p for p in self.c.inventory()['ports'] if p['id']=='usb3-port9')
        self.assertFalse(p['canDisconnect'])
        with self.assertRaises(ValueError):
            self.c.submit({'id':p['id'],'token':p['token'],'operation':'enable'})

    def device(self):
        p=self.sys/'bus/usb/devices/4-1'
        self.put(p/'product','Fixture disk')
        self.put(p/'4-1:1.0/bInterfaceClass','08')
        return p

    def test_hotplug_after_request_invalidates_execution(self):
        r=self.request()
        self.device()
        self.run_job(r)
        self.assertEqual(self.c.job['state'],'failed')
        self.assertEqual((self.q/'disable').read_text(),'0')

    def test_mounts_on_partitions_protect_whole_port(self):
        d=self.device()
        b=d/'block/sda/sda1'
        self.put(b/'dev','8:1')
        self.put(b/'partition','1')
        (self.sys/'class/block/sda1').symlink_to(b)
        self.put(self.proc/'self/mountinfo','1 2 8:1 / /mnt/disk rw - ext4 /dev/sda1 rw\n')
        self.assertFalse(self.c.inventory()['ports'][0]['canDisconnect'])
        with self.assertRaises(ValueError):
            self.c.submit(self.request())

    def test_exclusive_claim_rejects_open_disk_before_disconnect(self):
        d=self.device()
        b=d/'block/sda'
        self.put(b/'dev','8:0')
        (self.sys/'class/block/sda').symlink_to(b)
        r=self.request()
        with patch.object(usb.os,'open',side_effect=OSError(errno.EBUSY,'Disco ocupado')):
            self.run_job(r)
        self.assertEqual(self.c.job['state'],'failed')
        self.assertFalse(self.c.leases)
        self.assertEqual((self.q/'disable').read_text(),'0')

    def test_crash_journal_restores_only_owned_ports(self):
        self.c.leases={'usb4-port1':{'identity':self.c.identity(self.q),'until':0}}
        self.c.save()
        (self.p/'disable').write_text('1')
        (self.q/'disable').write_text('1')
        restarted=usb.UsbController(self.sys,self.c.journal,self.proc,self.dev)
        restarted.restore()
        self.assertEqual((self.p/'disable').read_text(),'1')
        self.assertEqual((self.q/'disable').read_text(),'0')

    def test_journal_never_operates_on_replaced_hub(self):
        self.c.leases={'usb4-port1':{'identity':self.c.identity(self.q),'until':0}}
        self.c.save()
        (self.q/'disable').write_text('1')
        self.q.rename(self.q.with_name('old-port'))
        self.q = self.port('usb4',1)
        (self.q/'disable').write_text('1')
        self.c.restore()
        self.assertEqual((self.q/'disable').read_text(),'1')
        self.assertFalse(self.c.leases)

    def test_partial_disable_failure_restores_first_channel(self):
        r=self.request()
        original=Path.write_text
        def fail(p,text,*a,**kw):
            if p==self.q/'disable' and text=='1':
                raise OSError('Fixture failure')
            return original(p,text,*a,**kw)
        with patch.object(Path,'write_text',fail):
            self.run_job(r)
        self.assertEqual(self.c.job['state'],'failed')
        self.assertEqual((self.p/'disable').read_text(),'0')
        self.assertFalse(self.c.leases)

if __name__ == '__main__':
    unittest.main()

import { expect,test } from 'bun:test';
import { FileVolumes,volumeForPath,type FileVolume,type VolumeSnapshot } from './file-volumes';
const root:FileVolume={id:'root',diskId:'nvme',device:'/dev/mapper/root',majorMinor:'252:0',name:'Sistema',filesystem:'ext4',uuid:'root',size:100,available:50,external:false,path:'/',mountId:'1',readOnly:false,readable:true,canMount:false};
const external:FileVolume={...root,id:'external',diskId:'usb',device:'/dev/sda1',name:'DATOS',filesystem:'exfat',uuid:'disk',external:true,path:'/run/media/binary/DATOS',mountId:'42'};
const snapshot=(volumes:FileVolume[]):VolumeSnapshot=>({ok:true,devices:[],volumes});

test('inventory deduplicates concurrent refreshes, caches briefly and explicitly refreshes hotplug',async()=>{
 let calls=0,data=snapshot([root]);const disks=new FileVolumes(async()=>{calls++;await Bun.sleep(5);return data;});
 await Promise.all([disks.snapshot(),disks.snapshot(true)]);expect(calls).toBe(1);
 data=snapshot([root,external]);expect((await disks.snapshot()).volumes).toHaveLength(1);
 expect((await disks.snapshot(true)).volumes).toHaveLength(2);expect(calls).toBe(2);
});
test('mounted roots include custom locations and reject the empty mountpoint after unplugging',async()=>{
 let data=snapshot([root,external]);const disks=new FileVolumes(async()=>data);
 expect(await disks.roots(external.path!+'/photos')).toEqual([external.path!]);
 data=snapshot([root]);await disks.snapshot(true);
 await expect(disks.roots(external.path!+'/photos')).rejects.toThrow('desconectado');
 expect(await disks.roots('/home/user')).toEqual([]);
});
test('source and destination tokens reject unplug, remount and reuse of a device path',async()=>{
 let data=snapshot([root,external]);const disks=new FileVolumes(async()=>data);
 await disks.validate(external.path!+'/file','external:42');
 data=snapshot([root,{...external,mountId:'43'}]);
 await expect(disks.validate(external.path!+'/file','external:42')).rejects.toThrow('desconectado');
 data=snapshot([root]);await expect(disks.validate(external.path!+'/file','external:42')).rejects.toThrow();
 data=snapshot([root,{...external,id:'replacement',uuid:'different'}]);await expect(disks.validate(external.path!+'/file','external:42')).rejects.toThrow();
 await expect(disks.validate('/home/user',{})).rejects.toThrow('inválida');
});
test('managed unplugged mountpoints stay blocked even after restarting AXON',async()=>{
 const disks=new FileVolumes(async()=>snapshot([root]));
 await expect(disks.roots('/mnt/axon-disks/1234567890abcdef/copied')).rejects.toThrow('sin montar');
 expect(await disks.roots('/mnt/ordinary-folder')).toEqual([]);
});
test('the most specific volume owns a nested path; prefix lookalikes do not match',()=>{
 expect(volumeForPath([root,external],external.path!+'/file')?.id).toBe('external');
 expect(volumeForPath([root,external],external.path!+'2/file')?.id).toBe('root');
});
test('root-disk tokens allow internal tmpfs submounts while external mounts retain their exact identity',async()=>{
 const disks=new FileVolumes(async()=>snapshot([root,external]));
 expect(await disks.validate('/tmp/source','root:1')).toBeUndefined();
 expect(await disks.validate(external.path!+'/target','external:42')).toBe('42');
});
test('inventory failure is visible and never publishes a stale snapshot as current',async()=>{
 let fail=false;const disks=new FileVolumes(async()=>fail?{ok:false,error:'offline'}:snapshot([root,external]));
 await disks.snapshot();fail=true;await expect(disks.snapshot(true)).rejects.toThrow('offline');
});
test('mount rejects arbitrary identifiers, uses a constrained runner and refreshes user permissions',async()=>{
 let calls=0;const id='a'.repeat(24);
 const disks=new FileVolumes(async()=>snapshot([{...external,id,readable:true}]),async request=>{
   calls++;expect(request).toEqual({action:'mount',id});
   return {...snapshot([{...external,id,readable:false}]),path:external.path!};
 });
 await expect(disks.mount('/dev/sda;touch /tmp/injected')).rejects.toThrow('inválido');expect(calls).toBe(0);
 const result=await disks.mount(id);expect(calls).toBe(1);expect(result.volumes[0].readable).toBe(true);expect(result.path).toBe(external.path!);
});

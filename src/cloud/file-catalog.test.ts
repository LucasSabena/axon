import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {PlatformStore} from '../platform/store';
import {CloudFileCatalog} from './file-catalog';
import {Hono} from 'hono';
import {registerCloudRoutes} from './routes';
import type {CloudProvider} from './provider';

test('Cloud organization stays owner/account/source scoped and only reads metadata, never file contents',async()=>{
  const dir=await mkdtemp(tmpdir()+'/axon-cloud-catalog-'),store=new PlatformStore(dir+'/state'),catalog=new CloudFileCatalog(store);let account='account-A',reads=0,downloads=0;
  const entries=[{name:'Fotos',path:'/Fotos',type:'dir',size:0,modified:null,downloadable:true},{name:'nota.txt',path:'/nota.txt',type:'file',size:5,modified:null,downloadable:true}];
  const p:CloudProvider={status:()=>({configured:true,serverConfigured:true,connected:true,account:null,sources:[{id:'account',name:'Cuenta',type:'account'}]}),connectionIdentity:()=>account,source:()=>({}),authorize:()=>'',callback:async()=>{},disconnect:async()=>{},list:async()=>({entries:entries as any,cursor:null}),metadata:async(_,source,path)=>{reads++;const e=entries.find(e=>e.path===path);if(!e)throw new Error('Missing');return e as any;},content:async()=>{downloads++;return new Response('never');}};
  try{
    const changed=await catalog.patch('owner','dropbox',p,'account',['/Fotos'],{favorite:true,pinned:true,tags:['Trabajo'],color:'purple'});expect(changed[0].metadata.tags).toEqual(['trabajo']);expect(reads).toBe(1);expect(downloads).toBe(0);
    expect(catalog.list('other','dropbox',account,'account')).toEqual([]);account='account-B';expect(catalog.list('owner','dropbox',account,'account')).toEqual([]);account='account-A';expect(catalog.list('owner','dropbox',account,'different-source')).toEqual([]);
    await expect(catalog.patch('owner','dropbox',p,'not-a-source',['/Fotos'],{favorite:true})).rejects.toThrow();
    await expect(catalog.patch('owner','dropbox',p,'account',['/Fotos'],{revision:0,color:'red'})).rejects.toThrow();
    const app=new Hono();app.use('*',async(c,next)=>{c.set('user','owner');await next();});registerCloudRoutes(app,store,dir+'/cloud',{dropbox:p});
    const list=await(await app.request('http://localhost/api/files/dropbox/list',{headers:{cookie:'axon_session=fixture'}})).json();expect(list.entries[0].organization.color).toBe('purple');expect(list.entries[1].organization).toBeUndefined();
    const annotations=await(await app.request('http://localhost/api/files/dropbox/organization',{headers:{cookie:'axon_session=fixture'}})).json();expect(annotations.entries[0].metadata.pinned).toBe(true);
    const restarted=new PlatformStore(dir+'/state');expect(new CloudFileCatalog(restarted).list('owner','dropbox',account,'account')[0].metadata.favorite).toBe(true);restarted.close();expect(downloads).toBe(0);
  }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

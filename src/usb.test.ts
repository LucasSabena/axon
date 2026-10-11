import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { registerUsbRoutes, fixtureUsbRunner } from './usb';
describe('USB API',()=>{
  const app = new Hono();registerUsbRoutes(app,fixtureUsbRunner());
  const post=(body:unknown)=>app.request('/api/usb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  test('inventory identifies logical reconnect and protected mounted disks',async()=>{
    const r=await (await app.request('/api/usb')).json();
    expect(r.physicalPowerVerified).toBe(false);expect(r.ports[1].canDisconnect).toBe(false);
  });
  test('rejects paths, stale identity, arbitrary keys and durations',async()=>{
    for(const b of [{id:'../../sys',token:'a'.repeat(64),operation:'enable'}, {id:'usb3-port3',token:'a'.repeat(64),operation:'disconnect',seconds:3600},{id:'usb3-port3',token:'a'.repeat(64),operation:'cycle',command:'reboot'}])expect((await post(b)).status).toBe(400);
    expect((await post({id:'usb3-port3',token:'f'.repeat(64),operation:'cycle'})).status).toBe(409);
  });
  test('mounted disk cannot be disconnected; an empty external port can',async()=>{
    expect((await post({id:'usb3-port5',token:'b'.repeat(64),operation:'cycle'})).status).toBe(409);
    expect((await post({id:'usb3-port3',token:'a'.repeat(64),operation:'cycle'})).status).toBe(202);
  });
});

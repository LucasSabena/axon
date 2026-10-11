import type { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { ON_HOST } from './host';
import { boundedCommand } from './storage/host-argv';
export type UsbRunner = (request: Record<string, unknown>) => Promise<any>;
export const usbRunner: UsbRunner = async request => {
  const source = await readFile(new URL('./usb-host.py', import.meta.url), 'utf8');
  const command = ['python3', '-c', source];
  const argv = ON_HOST ? command : ['nsenter', '-t', '1', '-m', '-u', '-i', '-n', '-p', '--', ...command];
  return JSON.parse(await boundedCommand(argv, JSON.stringify(request), undefined, 8000));
};
export function registerUsbRoutes(app: Hono, run: UsbRunner = usbRunner): void {
  app.get('/api/usb', async c => {
    try { const r = await run({ action: 'status' }); return c.json(r, r.ok ? 200 : 503); }
    catch { return c.json({ ok: false, error: 'No se pudo consultar el servicio USB.' }, 503); }
  });
  app.post('/api/usb', async c => {
    const b = await c.req.json().catch(() => null);
    if (!b || !['cycle','disconnect','enable'].includes(b.operation) || typeof b.id !== 'string' || !/^[a-z0-9.-]+-port\d+$/.test(b.id) ||
        typeof b.token !== 'string' || !/^[a-f0-9]{64}$/.test(b.token) ||
        Object.keys(b).some(k => !['operation','id','token','seconds'].includes(k)) ||
        (b.operation === 'disconnect' && ![15,30,60].includes(b.seconds)))
      return c.json({ ok: false, error: 'Puerto, estado o período inválido.' }, 400);
    try { const r = await run({ action: 'set', ...b }); return c.json(r, r.ok ? 202 : 409); }
    catch { return c.json({ ok: false, error: 'No se confirmó la operación. Consultá el estado antes de volver a intentar.' }, 503); }
  });
}
export function fixtureUsbRunner(): UsbRunner {
  const state: any = { ok: true, available: true, fixture: true, model: 'Acer Predator PT315-53', physicalPowerVerified: false,
    note: 'Reconexión de datos. Los puertos integrados de este modelo no permiten cortar los 5 V por software.', job: null,
    ports: [
      { id: 'usb3-port3', ports: ['usb3-port3','usb4-port1'], external: true, devices: [], disks: [], canDisconnect: true, reason: '', powerSwitching: false, token: 'a'.repeat(64), remainingSeconds: null, connectionStates: ['not attached','not attached'] },
      { id: 'usb3-port5', ports: ['usb3-port5','usb4-port3'], external: true, devices: [{id:'4-3',name:'TOSHIBA · DATOS 2',speed:'5000'}], disks: [{name:'sda1',mounted:true}], canDisconnect: false, reason: 'Tiene un disco montado. Desmontalo desde Discos antes de reconectar.', powerSwitching: false, token: 'b'.repeat(64), remainingSeconds: null, connectionStates: ['not attached','configured'] },
      { id: 'usb3-port9', ports: ['usb3-port9'], external: false, devices: [{id:'3-9',name:'Cámara integrada',speed:'480'}], disks: [], canDisconnect: false, reason: 'Puerto interno protegido.', powerSwitching: false, token: 'c'.repeat(64), remainingSeconds: null, connectionStates: ['suspended'] }
    ] };
  return async r => {
    if (r.action === 'set') {
      const p = state.ports.find(p=>p.id===r.id);
      if (!p || p.token !== r.token || !p.external || !p.canDisconnect && r.operation !== 'enable') return {ok:false,error:'Puerto protegido o estado cambiado.'};
      state.job = { port:p.id, state:'completed', operation:r.operation, error:'' };
      return {ok:true,accepted:true,job:structuredClone(state.job)};
    }
    return structuredClone(state);
  };
}

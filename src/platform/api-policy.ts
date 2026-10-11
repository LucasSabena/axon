import { PlatformError } from './store';

export type ApiLane = 'read'|'transfer'|'operation';
export interface ApiLimit { perMinute:number; burst:number; concurrent:number }
export const API_LIMITS:Record<ApiLane,ApiLimit> = {
  read:{perMinute:1200,burst:300,concurrent:8},
  transfer:{perMinute:2400,burst:120,concurrent:3},
  operation:{perMinute:120,burst:30,concurrent:2},
};
export interface ApiPolicy { limits:Record<ApiLane,ApiLimit>; dailyRequests:number }
export function apiPolicy(input?:unknown):ApiPolicy {
  const p=input as any;
  if(p!==undefined&&(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['limits','dailyRequests'].includes(k))))throw new PlatformError('Configuración de consumo inválida');
  const dailyRequests=p?.dailyRequests??0;
  if(!Number.isInteger(dailyRequests)||dailyRequests<0||dailyRequests>10_000_000)throw new PlatformError('El cupo diario debe ser de 0 a 10.000.000 solicitudes');
  if(p?.limits!==undefined&&(!p.limits||typeof p.limits!=='object'||Array.isArray(p.limits)||Object.keys(p.limits).some(k=>!['read','transfer','operation'].includes(k))))throw new PlatformError('Límites inválidos');
  const limits={} as Record<ApiLane,ApiLimit>;
  for(const lane of ['read','transfer','operation'] as const){
    const v=p?.limits?.[lane]??API_LIMITS[lane];
    if(!v||typeof v!=='object'||Object.keys(v).some(k=>!['perMinute','burst','concurrent'].includes(k))||!Number.isInteger(v.perMinute)||v.perMinute<1||v.perMinute>12000||!Number.isInteger(v.burst)||v.burst<1||v.burst>v.perMinute||!Number.isInteger(v.concurrent)||v.concurrent<1||v.concurrent>32)throw new PlatformError('Cada límite necesita solicitudes/minuto (1–12.000), ráfaga hasta ese límite y concurrencia (1–32)');
    limits[lane]={perMinute:v.perMinute,burst:v.burst,concurrent:v.concurrent};
  }
  return {limits,dailyRequests};
}

import { readFile, writeFile } from 'fs/promises';
import * as yaml from 'js-yaml';
import { $ } from 'bun';
import type { DomainMapping } from './types';

const CF_EMAIL = process.env.CLOUDFLARE_EMAIL;
const CF_API_KEY = process.env.CLOUDFLARE_API_KEY;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const TUNNEL_ID = process.env.CLOUDFLARE_TUNNEL_ID;
const CLOUDFLARED_CONFIG = process.env.CLOUDFLARED_CONFIG || '/etc/cloudflared/config.yml';
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'example.com';
// Hostname of Axon's own tunnel route — never considered a stale domain route.
const PANEL_HOSTNAME = `ports.${BASE_DOMAIN}`;
const CF_TIMEOUT_MS = 10_000;

// Everything that touches the Cloudflare API or the remote tunnel config
// needs credentials + zone + tunnel ids — check once up front instead of
// failing deep inside a mutation with a cryptic fetch error.
export function cloudflareConfigured(): boolean {
  return Boolean((CF_API_TOKEN || (CF_EMAIL && CF_API_KEY)) && ZONE_ID && ACCOUNT_ID && TUNNEL_ID);
}

interface CloudflareRecord {
  id: string;
  name: string;
  type: string;
  content: string;
}

interface TunnelIngress {
  hostname?: string;
  service: string;
  originRequest?: { noTLSVerify?: boolean };
}

interface TunnelConfig {
  tunnel_id: string;
  version: number;
  config: {
    ingress: TunnelIngress[];
  };
}

function headers(): Record<string, string> {
  if (CF_EMAIL && CF_API_KEY) {
    return {
      'X-Auth-Email': CF_EMAIL,
      'X-Auth-Key': CF_API_KEY,
      'Content-Type': 'application/json',
    };
  }
  if (CF_API_TOKEN) {
    return { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' };
  }
  return { 'Content-Type': 'application/json' };
}

export async function createDnsRecord(subdomain: string): Promise<{ success: boolean; recordId?: string; error?: string }> {
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        type: 'CNAME',
        name: subdomain,
        content: `${TUNNEL_ID}.cfargotunnel.com`,
        proxied: true,
      }),
      signal: AbortSignal.timeout(CF_TIMEOUT_MS),
    });
    const data = await response.json() as { success: boolean; result?: CloudflareRecord; errors?: { message: string }[] };
    if (!data.success) {
      return { success: false, error: data.errors?.[0]?.message || 'Unknown Cloudflare error' };
    }
    return { success: true, recordId: data.result?.id };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function deleteDnsRecord(recordId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${recordId}`, {
      method: 'DELETE',
      headers: headers(),
      signal: AbortSignal.timeout(CF_TIMEOUT_MS),
    });
    const data = await response.json() as { success: boolean; errors?: { message: string }[] };
    if (!data.success) {
      return { success: false, error: data.errors?.[0]?.message || 'Unknown Cloudflare error' };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function listDnsRecords(subdomain: string): Promise<CloudflareRecord[]> {
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?name=${encodeURIComponent(subdomain)}`,
      { headers: headers(), signal: AbortSignal.timeout(CF_TIMEOUT_MS) }
    );
    const data = await response.json() as { success: boolean; result?: CloudflareRecord[] };
    if (!data.success) return [];
    return data.result || [];
  } catch {
    return [];
  }
}

export async function listAllDnsRecords(type?: string): Promise<CloudflareRecord[]> {
  const out: CloudflareRecord[] = [];
  try {
    // Zones with >100 records need pagination — reading only page 1 left
    // dnsRecordId unset on imports and orphaned DNS records on delete.
    for (let page = 1; page <= 50; page++) {
      const url = new URL(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records`);
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      if (type) url.searchParams.set('type', type);
      const response = await fetch(url.toString(), { headers: headers(), signal: AbortSignal.timeout(CF_TIMEOUT_MS) });
      const data = await response.json() as { success: boolean; result?: CloudflareRecord[]; result_info?: { total_pages?: number } };
      if (!data.success) return out;
      out.push(...(data.result || []));
      if (page >= (data.result_info?.total_pages ?? 1) || !(data.result || []).length) break;
    }
    return out;
  } catch {
    return out;
  }
}

interface CloudflaredConfig {
  tunnel: string;
  'credentials-file'?: string;
  ingress: Array<Record<string, unknown>>;
}

export async function loadCloudflaredConfig(): Promise<CloudflaredConfig> {
  const content = await readFile(CLOUDFLARED_CONFIG, 'utf-8');
  return yaml.load(content) as CloudflaredConfig;
}

export async function saveCloudflaredConfig(config: CloudflaredConfig): Promise<void> {
  await writeFile(CLOUDFLARED_CONFIG, yaml.dump(config, { lineWidth: -1 }), 'utf-8');
}

export async function getRemoteTunnelConfig(): Promise<{ success: boolean; config?: TunnelConfig; error?: string }> {
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/configurations`,
      { headers: headers(), signal: AbortSignal.timeout(CF_TIMEOUT_MS) }
    );
    const data = await response.json() as { success: boolean; result?: TunnelConfig; errors?: { message: string }[] };
    if (!data.success) {
      return { success: false, error: data.errors?.[0]?.message || 'Unknown Cloudflare error' };
    }
    return { success: true, config: data.result };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function updateRemoteTunnelConfig(ingress: TunnelIngress[]): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/configurations`,
      {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ config: { ingress } }),
        signal: AbortSignal.timeout(CF_TIMEOUT_MS),
      }
    );
    const data = await response.json() as { success: boolean; errors?: { message: string }[]; result?: TunnelConfig };
    if (!data.success) {
      return { success: false, error: data.errors?.[0]?.message || 'Unknown Cloudflare error' };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function syncCloudflaredRoutes(domains: DomainMapping[]): Promise<{ success: boolean; error?: string }> {
  try {
    const remote = await getRemoteTunnelConfig();
    if (!remote.success || !remote.config) {
      return { success: false, error: remote.error || 'Failed to fetch remote tunnel config' };
    }

    const managedHostnames = new Set(domains.map((d) => d.fullDomain));
    const managedSuffix = `.${BASE_DOMAIN}`;
    let ingress = remote.config.config.ingress || [];

    // Remove managed routes: current domain hostnames are re-added below
    // (update path), and any OTHER route under the base domain is stale —
    // it belonged to a since-deleted domain and would keep proxying to a
    // dead localhost:port. Keep the panel's own route and anything outside
    // the base domain (user-managed tunnels).
    ingress = ingress.filter((entry) => {
      if (!entry.hostname) return true;
      if (managedHostnames.has(entry.hostname)) return false;
      if (entry.hostname !== PANEL_HOSTNAME && entry.hostname.endsWith(managedSuffix)) return false;
      return true;
    });

    // Add/update managed routes before the catch-all
    for (const domain of domains) {
      const entry: TunnelIngress = {
        hostname: domain.fullDomain,
        service: domain.target,
        // Local HTTPS services commonly use self-signed certs; skip origin TLS verify.
        originRequest: domain.target.startsWith('https://') ? { noTLSVerify: true } : {},
      };
      const catchAllIndex = ingress.findIndex((e) => !e.hostname);
      if (catchAllIndex >= 0) {
        ingress.splice(catchAllIndex, 0, entry);
      } else {
        ingress.push(entry);
      }
    }

    const update = await updateRemoteTunnelConfig(ingress);
    if (!update.success) {
      return { success: false, error: update.error };
    }

    // Cloudflared will detect and apply the remote config change automatically.
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Drop edge-cached copies under URL prefixes (e.g. "share.example.com/s/<id>/").
// Prefix purge is available on every Cloudflare plan; failures are non-fatal.
export async function purgeCachePrefixes(prefixes: string[]): Promise<{ success: boolean; error?: string }> {
  if (!ZONE_ID || !prefixes.length) return { success: false, error: 'Cloudflare no configurado' };
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ prefixes: prefixes.slice(0, 30) }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json()) as { success: boolean; errors?: { message: string }[] };
    return data.success ? { success: true } : { success: false, error: data.errors?.[0]?.message || 'purge falló' };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

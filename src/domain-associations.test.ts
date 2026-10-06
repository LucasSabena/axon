import { describe, expect, test } from 'bun:test';
import { domainsForPorts, domainsForProject } from './domain-associations';
import type { DomainMapping, Project } from './types';

const domain = (id: string, port = 3100, processType: DomainMapping['processType'] = 'process'): DomainMapping => ({
  id, port, processType, projectName: 'demo', subdomain: id,
  fullDomain: `${id}.example.com`, target: `http://localhost:${port}`, createdAt: '2026-10-05T15:32:46Z',
});
const project: Project = { id: 'demo-web', name: '@demo/web', cwd: '/projects/demo/apps/web', type: 'node', autoDetect: true,
  running: { pid: 123, ports: [3100], startedAt: '2026-10-05T15:10:28Z' } };

describe('domain associations', () => {
  test('Demo remains linked when project and package display names differ', () => {
    const d = domain('demo');
    expect(domainsForPorts([d], [3100], 'process')).toEqual([d]);
    expect(domainsForProject([d], project)).toEqual([d]);
  });
  test('all aliases and listening ports appear without duplicate associations', () => {
    const aliases = [domain('demo'), domain('preview'), domain('brand', 3101)];
    expect(domainsForPorts(aliases, [3100, 3100, 3101], 'process')).toEqual(aliases);
  });
  test('unrelated ports, invalid ports, and Docker domains are excluded', () => {
    expect(domainsForPorts([domain('docker', 3100, 'docker'), domain('other', 3200), domain('invalid', 0)], [3100, 0], 'process')).toEqual([]);
    expect(domainsForProject([domain('docker', 3100, 'docker')], project)).toEqual([]);
  });
  test('a stopped project keeps explicitly registered domains', () => {
    const d = domain('demo');
    expect(domainsForProject([d], { ...project, name: 'demo', running: undefined })).toEqual([d]);
    expect(domainsForProject([d], { ...project, running: undefined })).toEqual([]);
  });
  test('configured ports are a fallback; current running ports take precedence', () => {
    const d = domain('demo');
    expect(domainsForProject([d], { ...project, port: 3100, running: undefined })).toEqual([d]);
    expect(domainsForProject([d], { ...project, port: 3100, running: { ...project.running!, ports: [3200] } })).toEqual([]);
  });
});

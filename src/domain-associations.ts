import type { DomainMapping, Project } from './types';

// The target port is the routing contract. Display/package names can differ
// from the project name supplied when the domain was created.
export function domainsForPorts(domains: DomainMapping[], ports: number[], processType: DomainMapping['processType']): DomainMapping[] {
  const targets = new Set(ports.filter(port => Number.isInteger(port) && port > 0 && port <= 65535));
  return domains.filter(domain => domain.processType === processType && targets.has(domain.port));
}

export function domainsForProject(domains: DomainMapping[], project: Project): DomainMapping[] {
  const byPort = new Set(domainsForPorts(domains, project.running?.ports || (project.port ? [project.port] : []), 'process'));
  return domains.filter(domain => domain.processType === 'process' &&
    (byPort.has(domain) || domain.projectName === project.name || domain.projectName === project.id));
}

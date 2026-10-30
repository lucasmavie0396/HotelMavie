import { isIP } from 'node:net';
import { promises as dns } from 'node:dns';

const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export function normalizeDomain(value: unknown) {
  if (value === null || value === undefined) return value;
  const text = String(value).trim().toLowerCase();
  if (!text) return null;
  return text
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

export function isValidDomain(value: string) {
  return DOMAIN.test(value) && !isIP(value);
}

export function domainVariants(host: string) {
  const clean = normalizeDomain(host) ?? '';
  const bare = clean.replace(/^www\./, '');
  return [...new Set([clean, bare, `www.${bare}`])].filter(Boolean);
}

export function siteTarget(dnsTarget?: string, corsOrigin?: string) {
  const configured = normalizeDomain(dnsTarget);
  if (configured) return configured;
  for (const origin of (corsOrigin ?? '').split(',')) {
    const host = normalizeDomain(origin);
    if (host && host !== 'localhost' && !host.startsWith('127.') && (isIP(host) || host.includes('.'))) return host;
  }
  return null;
}

async function lookup<T>(fn: () => Promise<T[]>) {
  try {
    return await fn();
  } catch {
    return [] as T[];
  }
}

export async function checkDomain(domain: string, target: string | null) {
  const targetIsIp = target ? isIP(target) !== 0 : false;
  const targetIps = target ? (targetIsIp ? [target] : await lookup(() => dns.resolve4(target))) : [];
  const names = domainVariants(domain);
  const records = await Promise.all(
    names.map(async (name) => {
      const [a, aaaa, cname] = await Promise.all([lookup(() => dns.resolve4(name)), lookup(() => dns.resolve6(name)), lookup(() => dns.resolveCname(name))]);
      const pointsToTarget =
        !!target && (cname.some((value) => normalizeDomain(value) === target) || (a.length > 0 && a.every((ip) => targetIps.includes(ip))));
      return { name, a, aaaa, cname, ok: pointsToTarget, exists: a.length + aaaa.length + cname.length > 0 };
    }),
  );
  const bare = names.find((name) => !name.startsWith('www.')) ?? domain;
  const www = `www.${bare}`;
  const instructions = !target
    ? []
    : targetIsIp
      ? [
          { type: 'A', name: bare, value: target },
          { type: 'A', name: www, value: target },
        ]
      : [
          ...targetIps.map((ip) => ({ type: 'A', name: bare, value: ip })),
          { type: 'CNAME', name: www, value: target },
        ];
  return { domain, target, targetIps, records, instructions, ok: records.some((record) => record.name === domain && record.ok) };
}

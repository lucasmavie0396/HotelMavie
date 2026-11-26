import { createPrivateKey, createPublicKey, KeyObject, sign, verify } from 'node:crypto';

export const LICENSE_PREFIX = 'MAVIE1';
export const UNLOCK_PREFIX = 'MAVIER1';

export interface LicenseData {
  id: string;
  name: string;
  nuit: string;
  issuedAt: string;
  validUntil: string;
  v: number;
}

export interface UnlockData {
  id: string;
  nuit: string;
  request: string;
  issuedAt: string;
  validUntil: string;
  v: number;
}

const base64url = (data: Buffer) => data.toString('base64url');

export function validNuit(value: string | null | undefined) {
  return Boolean(value && /^\d{9}$/.test(value));
}

export function normalizeLicense(text: string) {
  return text.replace(/\s+/g, '');
}

function encode(prefix: string, data: object, privateKey: KeyObject | string) {
  const bytes = Buffer.from(JSON.stringify(data), 'utf8');
  const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey;
  const signature = sign('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' });
  return `${prefix}.${base64url(bytes)}.${base64url(signature)}`;
}

function decode<T>(prefix: string, text: string, publicKey: KeyObject | string): { data: T | null; error: string | null } {
  const parts = normalizeLicense(text).split('.');
  if (parts.length !== 3 || parts[0] !== prefix) return { data: null, error: 'Formato invalido' };
  let bytes: Buffer;
  let signature: Buffer;
  try {
    bytes = Buffer.from(parts[1], 'base64url');
    signature = Buffer.from(parts[2], 'base64url');
  } catch {
    return { data: null, error: 'Formato invalido' };
  }
  const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
  let valid = false;
  try {
    valid = verify('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' }, signature);
  } catch {
    valid = false;
  }
  if (!valid) return { data: null, error: 'Assinatura invalida: o texto foi alterado ou nao e do MAVIE-HGest' };
  try {
    return { data: JSON.parse(bytes.toString('utf8')) as T, error: null };
  } catch {
    return { data: null, error: 'Formato invalido' };
  }
}

export function encodeLicense(data: LicenseData, privateKey: KeyObject | string) {
  if (!data.name.trim()) throw new Error('Indique o nome comercial');
  if (!validNuit(data.nuit)) throw new Error('NUIT invalido: 9 algarismos');
  return encode(LICENSE_PREFIX, data, privateKey);
}

export function decodeLicense(text: string, publicKey: KeyObject | string) {
  const result = decode<LicenseData>(LICENSE_PREFIX, text, publicKey);
  if (result.data && (!result.data.validUntil || !validNuit(result.data.nuit))) return { data: null, error: 'Formato invalido' };
  return result;
}

export function unlockRequest(nuit: string, lastSeenAt: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${nuit}-${lastSeenAt.getUTCFullYear()}${pad(lastSeenAt.getUTCMonth() + 1)}${pad(lastSeenAt.getUTCDate())}${pad(lastSeenAt.getUTCHours())}${pad(lastSeenAt.getUTCMinutes())}`;
}

export function encodeUnlock(data: UnlockData, privateKey: KeyObject | string) {
  return encode(UNLOCK_PREFIX, data, privateKey);
}

export function decodeUnlock(text: string, publicKey: KeyObject | string) {
  return decode<UnlockData>(UNLOCK_PREFIX, text, publicKey);
}

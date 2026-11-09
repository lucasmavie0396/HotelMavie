import { AccessLevel, UserRole } from '@prisma/client';

export const ACCESS_AREAS = ['reservations', 'guests', 'rooms', 'pos', 'invoices', 'accounts', 'cash', 'products', 'stock', 'purchases', 'hr', 'reports', 'audit', 'settings'] as const;

export type AccessArea = (typeof ACCESS_AREAS)[number];
export type AccessLevels = Record<AccessArea, AccessLevel>;

const ROUTE_AREAS: [RegExp, AccessArea][] = [
  [/^\/(reservations|reservation-groups)(\/|$)/, 'reservations'],
  [/^\/guests(\/|$)/, 'guests'],
  [/^\/rooms(\/|$)/, 'rooms'],
  [/^\/(orders|kds|dining-tables)(\/|$)/, 'pos'],
  [/^\/(invoices|charges|payments|invoice-series|at|saft)(\/|$)/, 'invoices'],
  [/^\/(accounts|invoices-open|receipts)(\/|$)/, 'accounts'],
  [/^\/(cash-registers|cash-sessions)(\/|$)/, 'cash'],
  [/^\/(products|product-categories)(\/|$)/, 'products'],
  [/^\/(stock-documents|stock-movements|warehouses)(\/|$)/, 'stock'],
  [/^\/(purchases|suppliers)(\/|$)/, 'purchases'],
  [/^\/hr(\/|$)/, 'hr'],
  [/^\/reports(\/|$)/, 'reports'],
  [/^\/audit-logs(\/|$)/, 'audit'],
  [/^\/(tax-rates|payment-types|printers|email-logs)(\/|$)/, 'settings'],
];

const REFERENCE_READS = /^\/(tax-rates|payment-types|printers)(\/|$)/;

const READ_THROUGH: Partial<Record<AccessArea, AccessArea[]>> = {
  guests: ['reservations'],
  rooms: ['reservations'],
  products: ['pos', 'stock', 'purchases'],
  stock: ['products', 'purchases', 'pos'],
  cash: ['reservations', 'invoices', 'accounts'],
};

const RANK: Record<AccessLevel, number> = { NONE: 0, VIEW: 1, MANAGE: 2 };

export function areaForRoute(path: string, method: string): AccessArea | null {
  const route = path.replace(/^\/api(?=\/|$)/, '');
  if (method === 'GET' && REFERENCE_READS.test(route)) return null;
  return ROUTE_AREAS.find(([pattern]) => pattern.test(route))?.[1] ?? null;
}

export function reaches(level: AccessLevel | undefined, needed: AccessLevel) {
  return RANK[level ?? AccessLevel.NONE] >= RANK[needed];
}

export function allowsArea(levels: AccessLevels, area: AccessArea, method: string, salesAccess: boolean) {
  const needed = method === 'GET' || method === 'HEAD' ? AccessLevel.VIEW : AccessLevel.MANAGE;
  if (reaches(levels[area], needed)) return true;
  if (needed === AccessLevel.VIEW && READ_THROUGH[area]?.some((other) => reaches(levels[other], AccessLevel.VIEW))) return true;
  return salesAccess && reaches(levels.pos, needed);
}

function levels(values: Partial<AccessLevels>): AccessLevels {
  return Object.fromEntries(ACCESS_AREAS.map((area) => [area, values[area] ?? AccessLevel.NONE])) as AccessLevels;
}

const M = AccessLevel.MANAGE;
const V = AccessLevel.VIEW;

export const DEFAULT_LEVELS: Record<Exclude<UserRole, 'ADMIN'>, AccessLevels> = {
  MANAGER: levels(Object.fromEntries(ACCESS_AREAS.map((area) => [area, M]))),
  RECEPTION: levels({ reservations: M, guests: M, rooms: M, pos: M, invoices: M, accounts: M, cash: M, products: V, stock: V, hr: V, reports: V }),
  CASHIER: levels({ pos: M, cash: M }),
};

export function completeLevels(values: Partial<Record<string, AccessLevel>>): AccessLevels {
  return levels(values as Partial<AccessLevels>);
}

export type AccessLevel = 'NONE' | 'VIEW' | 'MANAGE';
export type AccessLevels = Record<string, AccessLevel>;

export const ROUTE_AREAS: Record<string, string> = {
  calendar: 'reservations',
  reservations: 'reservations',
  reservation: 'reservations',
  guests: 'guests',
  rooms: 'rooms',
  pos: 'pos',
  kitchen: 'pos',
  invoices: 'invoices',
  accounts: 'accounts',
  cash: 'cash',
  products: 'products',
  stock: 'stock',
  hr: 'hr',
  reports: 'reports',
  purchases: 'purchases',
  audit: 'audit',
  settings: 'settings',
};

export const MENU_ORDER = ['calendar', 'reservations', 'guests', 'rooms', 'pos', 'kitchen', 'invoices', 'accounts', 'cash', 'products', 'stock', 'hr', 'reports', 'purchases', 'audit', 'settings'];

export function allowedRoutes(levels: AccessLevels) {
  return MENU_ORDER.filter((name) => (levels[ROUTE_AREAS[name]] ?? 'NONE') !== 'NONE');
}

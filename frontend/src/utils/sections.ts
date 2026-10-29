export interface Section {
  label: string;
  icon: string;
  gradient: string;
  dot: string;
}

export const SECTIONS: Record<string, Section> = {
  dashboard: {
    label: 'Painel',
    icon: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z',
    gradient: 'from-indigo-600 via-violet-600 to-fuchsia-600',
    dot: 'bg-gradient-to-br from-indigo-500 to-fuchsia-500',
  },
  calendar: {
    label: 'Calendario',
    icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
    gradient: 'from-sky-500 via-blue-600 to-indigo-600',
    dot: 'bg-gradient-to-br from-sky-400 to-indigo-500',
  },
  reservations: {
    label: 'Reservas',
    icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11',
    gradient: 'from-indigo-600 via-indigo-500 to-violet-600',
    dot: 'bg-gradient-to-br from-indigo-500 to-violet-500',
  },
  guests: {
    label: 'Hospedes',
    icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
    gradient: 'from-emerald-500 via-teal-500 to-cyan-600',
    dot: 'bg-gradient-to-br from-emerald-400 to-teal-500',
  },
  rooms: {
    label: 'Quartos',
    icon: 'M2 20v-8a2 2 0 012-2h16a2 2 0 012 2v8M2 16h20M6 10V7a2 2 0 012-2h8a2 2 0 012 2v3',
    gradient: 'from-amber-500 via-orange-500 to-rose-500',
    dot: 'bg-gradient-to-br from-amber-400 to-orange-500',
  },
  pos: {
    label: 'Restaurante / Bar',
    icon: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2M7 2v20M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7',
    gradient: 'from-rose-500 via-pink-500 to-fuchsia-600',
    dot: 'bg-gradient-to-br from-rose-400 to-pink-500',
  },
  invoices: {
    label: 'Faturacao',
    icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
    gradient: 'from-violet-600 via-purple-600 to-fuchsia-600',
    dot: 'bg-gradient-to-br from-violet-500 to-purple-500',
  },
  accounts: {
    label: 'Contas correntes',
    icon: 'M2 7h20v12H2zM2 11h20M6 15h4M16 3l-4 4-4-4',
    gradient: 'from-cyan-500 via-sky-600 to-blue-600',
    dot: 'bg-gradient-to-br from-cyan-400 to-sky-500',
  },
  cash: {
    label: 'Caixa',
    icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
    gradient: 'from-green-500 via-emerald-600 to-teal-600',
    dot: 'bg-gradient-to-br from-green-400 to-emerald-500',
  },
  products: {
    label: 'Produtos',
    icon: 'M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01',
    gradient: 'from-orange-500 via-amber-500 to-yellow-500',
    dot: 'bg-gradient-to-br from-orange-400 to-amber-400',
  },
  stock: {
    label: 'Stocks',
    icon: 'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12',
    gradient: 'from-lime-500 via-green-500 to-emerald-600',
    dot: 'bg-gradient-to-br from-lime-400 to-green-500',
  },
  hr: {
    label: 'Recursos humanos',
    icon: 'M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16',
    gradient: 'from-pink-500 via-fuchsia-500 to-purple-600',
    dot: 'bg-gradient-to-br from-pink-400 to-fuchsia-500',
  },
  purchases: {
    label: 'Compras',
    icon: 'M9 22a1 1 0 100-2 1 1 0 000 2zM20 22a1 1 0 100-2 1 1 0 000 2zM1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6',
    gradient: 'from-teal-500 via-cyan-600 to-sky-600',
    dot: 'bg-gradient-to-br from-teal-400 to-cyan-500',
  },
  reports: {
    label: 'Relatorios',
    icon: 'M18 20V10M12 20V4M6 20v-6',
    gradient: 'from-fuchsia-600 via-purple-600 to-indigo-600',
    dot: 'bg-gradient-to-br from-fuchsia-500 to-purple-500',
  },
  settings: {
    label: 'Configuracao',
    icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
    gradient: 'from-slate-600 via-slate-700 to-indigo-800',
    dot: 'bg-gradient-to-br from-slate-400 to-slate-600',
  },
  users: {
    label: 'Utilizadores',
    icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    gradient: 'from-blue-600 via-indigo-600 to-violet-700',
    dot: 'bg-gradient-to-br from-blue-400 to-indigo-500',
  },
  hotels: {
    label: 'Hoteis',
    icon: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01M9 18v.01',
    gradient: 'from-violet-600 via-indigo-600 to-sky-600',
    dot: 'bg-gradient-to-br from-violet-400 to-indigo-500',
  },
};

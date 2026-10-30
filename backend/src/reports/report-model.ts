import { Hotel, UserRole } from '@prisma/client';

export type ReportParams = 'period' | 'date' | 'stock' | 'session' | 'none';

export interface ReportDefinition {
  key: string;
  title: string;
  description: string;
  group: string;
  params: ReportParams;
  roles: UserRole[];
  hidden?: boolean;
}

export interface ReportKpi {
  label: string;
  value: string;
}

export interface ReportColumn {
  label: string;
  align?: 'left' | 'right' | 'center';
  weight?: number;
}

export interface ReportTable {
  columns: ReportColumn[];
  rows: string[][];
  totals?: string[];
  empty?: string;
}

export interface ReportSection {
  title: string;
  kpis?: ReportKpi[];
  table?: ReportTable;
  note?: string;
}

export interface Report {
  key: string;
  title: string;
  period: string;
  generatedAt: string;
  generatedBy: string;
  hotel: Hotel;
  sections: ReportSection[];
}

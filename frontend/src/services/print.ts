import { api } from '@/services/api';
import type { PaperWidth } from '@/types';

export type PrintDocument = 'ORDER' | 'VOID' | 'PREBILL' | 'STATEMENT' | 'INVOICE' | 'RECEIPT' | 'PAYMENT' | 'TEST' | 'REPORT';

export interface PrintRequest {
  document: PrintDocument;
  orderId?: number;
  itemId?: number;
  reservationId?: number;
  invoiceId?: number;
  receiptId?: number;
  paymentId?: number;
  printerId?: number | null;
  station?: 'KITCHEN' | 'BAR' | 'NONE';
  sentAt?: string;
  report?: string;
  hotelId?: number | null;
  from?: string;
  to?: string;
  date?: string;
  warehouseId?: number;
}

type PrintResult =
  | { status: 'printed'; printer: { id: number; name: string } }
  | { status: 'local'; printer: { id: number; name: string; localName: string }; copies: number; data: string }
  | { status: 'browser'; paper: PaperWidth; copies: number; printer: { id: number; name: string } | null };

export interface LocalPrinter {
  name: string;
  driver: string;
  port: string;
  isDefault: boolean;
  offline: boolean;
  shared: boolean;
}

const AGENT_KEY = 'mavie.printAgentUrl';
export const DEFAULT_AGENT_URL = 'http://127.0.0.1:9123';

export function agentUrl() {
  try {
    return localStorage.getItem(AGENT_KEY) || DEFAULT_AGENT_URL;
  } catch {
    return DEFAULT_AGENT_URL;
  }
}

export function setAgentUrl(url: string) {
  try {
    if (!url || url === DEFAULT_AGENT_URL) localStorage.removeItem(AGENT_KEY);
    else localStorage.setItem(AGENT_KEY, url.replace(/\/$/, ''));
  } catch {
    return;
  }
}

async function agent<T>(path: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(`${agentUrl()}${path}`, { ...init, headers: { 'Content-Type': 'application/json' } });
  } catch {
    throw new Error('O agente de impressao nao esta a correr neste computador (print-agent/iniciar.cmd)');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? `Agente de impressao: erro ${response.status}`);
  return body as T;
}

export function listLocalPrinters() {
  return agent<LocalPrinter[]>('/printers');
}

function printPdf(blob: Blob) {
  return new Promise<void>((resolve) => {
    const url = URL.createObjectURL(blob);
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.src = url;
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        window.open(url, '_blank');
      }
      setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(url);
      }, 60_000);
      resolve();
    };
    document.body.appendChild(frame);
  });
}

export async function printPdfFrom(path: string, params: Record<string, unknown>) {
  const { data } = await api.get<Blob>(path, { params, responseType: 'blob' });
  await printPdf(data);
}

export async function printDocument(request: PrintRequest) {
  const { data } = await api.post<PrintResult>('/print', request);
  if (data.status === 'printed') {
    return `Impresso em ${data.printer.name}`;
  }
  if (data.status === 'local') {
    await agent('/print', { method: 'POST', body: JSON.stringify({ printer: data.printer.localName, data: data.data, copies: data.copies }) });
    return `Impresso em ${data.printer.name}`;
  }
  const params = Object.fromEntries(Object.entries({ ...request, paper: data.paper }).map(([key, value]) => [key, value === null ? 'null' : value]));
  const { data: pdf } = await api.get<Blob>('/print/pdf', { params, responseType: 'blob' });
  await printPdf(pdf);
  return data.printer ? `Enviado para impressao (${data.printer.name})` : 'Enviado para impressao';
}

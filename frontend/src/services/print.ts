import { reactive } from 'vue';
import { t, translated } from '@/i18n';
import { api } from '@/services/api';
import type { PaperWidth } from '@/types';

interface PdfEntry {
  url: string;
  title: string;
  paper: PaperWidth;
}

export const pdfPreview = reactive({ url: '', title: '', paper: 'MM80' as PaperWidth, queue: [] as PdfEntry[], index: 0 });

function select(index: number) {
  const entry = pdfPreview.queue[index];
  if (!entry) return;
  Object.assign(pdfPreview, { index, url: entry.url, title: entry.title, paper: entry.paper });
}

export function showPdf(blob: Blob, title: string, paper: PaperWidth) {
  pdfPreview.queue.push({ url: URL.createObjectURL(blob), title, paper });
  if (pdfPreview.queue.length === 1) select(0);
}

export function showPdfAt(index: number) {
  select(index);
}

export function closePdf() {
  for (const entry of pdfPreview.queue) URL.revokeObjectURL(entry.url);
  Object.assign(pdfPreview, { url: '', queue: [], index: 0 });
}

export async function previewPdfFrom(path: string, params: Record<string, unknown>, title: string, paper: PaperWidth) {
  const { data } = await api.get<Blob>(path, { params, responseType: 'blob' });
  showPdf(data, title, paper);
}

export type PrintDocument = 'ORDER' | 'VOID' | 'PREBILL' | 'STATEMENT' | 'INVOICE' | 'RECEIPT' | 'PAYMENT' | 'TEST' | 'REPORT';

const DOCUMENT_TITLES = translated<PrintDocument>('print.documents', ['ORDER', 'VOID', 'PREBILL', 'STATEMENT', 'INVOICE', 'RECEIPT', 'PAYMENT', 'TEST', 'REPORT']);

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
  | { status: 'pdf'; paper: PaperWidth; copies: number; printer: { id: number; name: string } }
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
    throw new Error(t('print.agentDown'));
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? t('print.agentError', { status: response.status }));
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
    return t('print.printedOn', { name: data.printer.name });
  }
  if (data.status === 'local') {
    await agent('/print', { method: 'POST', body: JSON.stringify({ printer: data.printer.localName, data: data.data, copies: data.copies }) });
    return t('print.printedOn', { name: data.printer.name });
  }
  const params = Object.fromEntries(Object.entries({ ...request, paper: data.paper }).map(([key, value]) => [key, value === null ? 'null' : value]));
  const { data: pdf } = await api.get<Blob>('/print/pdf', { params, responseType: 'blob' });
  if (data.status === 'pdf') {
    showPdf(pdf, `${DOCUMENT_TITLES[request.document]} · ${data.printer.name}`, data.paper);
    return t('print.pdfOpened', { name: data.printer.name });
  }
  await printPdf(pdf);
  return data.printer ? t('print.sentTo', { name: data.printer.name }) : t('print.sent');
}

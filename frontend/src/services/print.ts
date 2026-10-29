import { api } from '@/services/api';
import type { PaperWidth } from '@/types';

export type PrintDocument = 'ORDER' | 'VOID' | 'PREBILL' | 'STATEMENT' | 'INVOICE' | 'RECEIPT' | 'PAYMENT' | 'TEST';

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
}

type PrintResult =
  | { status: 'printed'; printer: { id: number; name: string } }
  | { status: 'browser'; paper: PaperWidth; copies: number; printer: { id: number; name: string } | null };

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

export async function printDocument(request: PrintRequest) {
  const { data } = await api.post<PrintResult>('/print', request);
  if (data.status === 'printed') {
    return `Impresso em ${data.printer.name}`;
  }
  const params = Object.fromEntries(Object.entries({ ...request, paper: data.paper }).map(([key, value]) => [key, value === null ? 'null' : value]));
  const { data: pdf } = await api.get<Blob>('/print/pdf', { params, responseType: 'blob' });
  await printPdf(pdf);
  return data.printer ? `Enviado para impressao (${data.printer.name})` : 'Enviado para impressao';
}

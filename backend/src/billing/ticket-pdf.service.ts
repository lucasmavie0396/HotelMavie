import { Injectable } from '@nestjs/common';
import { Hotel, Invoice, InvoiceLine, InvoiceType } from '@prisma/client';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { printedHash, qrCodeContent } from '../at/at-format';
import { AtSigningService } from '../at/at-signing.service';

const WIDTH = 226.77;
const MARGIN = 10;
const INNER = WIDTH - MARGIN * 2;
const TIME_ZONE = process.env.AT_TIMEZONE ?? 'Europe/Lisbon';

type Row =
  | { kind: 'text'; text: string; size?: number; bold?: boolean; align?: 'left' | 'center' | 'right' }
  | { kind: 'cols'; left: string; right: string; size?: number; bold?: boolean }
  | { kind: 'rule' }
  | { kind: 'space'; height?: number }
  | { kind: 'image'; buffer: Buffer; size: number };

const DOC_TITLES: Record<InvoiceType, string> = {
  INVOICE: 'Fatura',
  INVOICE_RECEIPT: 'Fatura-Recibo',
  CREDIT_NOTE: 'Nota de Credito',
  RECEIPT: 'Recibo',
};

export interface TicketLine {
  quantity: { toString(): string };
  description: string;
  total?: { toString(): string };
  notes?: string | null;
  struck?: boolean;
}

export class Ticket {
  readonly rows: Row[] = [];

  constructor(private readonly currency = 'EUR') {}

  money(value: { toString(): string } | number) {
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: this.currency }).format(Number(value.toString()));
  }

  text(text: string, options: { size?: number; bold?: boolean; align?: 'left' | 'center' | 'right' } = {}) {
    this.rows.push({ kind: 'text', text, ...options });
    return this;
  }

  cols(left: string, right: string, options: { size?: number; bold?: boolean } = {}) {
    this.rows.push({ kind: 'cols', left, right, ...options });
    return this;
  }

  rule() {
    this.rows.push({ kind: 'rule' });
    return this;
  }

  space(height = 6) {
    this.rows.push({ kind: 'space', height });
    return this;
  }

  image(buffer: Buffer, size: number) {
    this.rows.push({ kind: 'image', buffer, size });
    return this;
  }

  header(hotel: Hotel) {
    this.text(hotel.legalName ?? hotel.name, { bold: true, size: 11, align: 'center' });
    if (hotel.taxId) this.text(`NIF ${hotel.taxId}`, { align: 'center', size: 8 });
    if (hotel.address) this.text(hotel.address, { align: 'center', size: 8 });
    return this.rule();
  }

  lines(items: TicketLine[], withPrices = true) {
    for (const item of items) {
      const label = `${Number(item.quantity.toString())} x ${item.description}${item.struck ? ' (ANULADO)' : ''}`;
      if (withPrices && item.total !== undefined) {
        this.cols(label, item.struck ? '0,00' : this.money(item.total));
      } else {
        this.text(label, { size: 11, bold: true });
      }
      if (item.notes) this.text(`  > ${item.notes}`, { size: 8 });
    }
    return this;
  }

  static when(date: Date) {
    return date.toLocaleString('pt-PT', { timeZone: TIME_ZONE, dateStyle: 'short', timeStyle: 'short' });
  }
}

@Injectable()
export class TicketPdfService {
  constructor(private readonly signing: AtSigningService) {}

  render(ticket: Ticket) {
    const probe = new PDFDocument({ size: [WIDTH, 1000], margin: MARGIN });
    let height = MARGIN * 2;
    for (const row of ticket.rows) height += this.rowHeight(probe, row);
    probe.end();

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: [WIDTH, Math.ceil(height) + 4], margin: MARGIN, autoFirstPage: true });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      let y = MARGIN;
      for (const row of ticket.rows) {
        y = this.drawRow(doc, row, y);
      }
      doc.end();
    });
  }

  async invoice(invoice: Invoice & { lines: InvoiceLine[]; creditOf?: { fullNumber: string } | null }, hotel: Hotel) {
    const ticket = new Ticket(invoice.currency).header(hotel);
    ticket.text(`${DOC_TITLES[invoice.type]} ${invoice.fullNumber}`, { bold: true, align: 'center' });
    ticket.text(Ticket.when(invoice.issuedAt), { align: 'center', size: 8 });
    ticket.text(`ATCUD: ${invoice.atcud ?? '0'}`, { align: 'center', size: 8 });
    if (invoice.creditOf) ticket.text(`Ref.: ${invoice.creditOf.fullNumber}`, { align: 'center', size: 8 });
    ticket.rule();
    ticket.text(`Cliente: ${invoice.customerName}`, { size: 8 });
    ticket.text(`NIF: ${invoice.customerTaxId ?? 'Consumidor final'}`, { size: 8 });
    ticket.rule();
    ticket.lines(invoice.lines.map((line) => ({ quantity: line.quantity, description: `${line.description} (${Number(line.taxRate)}%)`, total: line.grossAmount })));
    ticket.rule();
    const rates = new Map<string, { base: number; tax: number }>();
    for (const line of invoice.lines) {
      const key = `${Number(line.taxRate)}%`;
      const current = rates.get(key) ?? { base: 0, tax: 0 };
      current.base += Number(line.netAmount);
      current.tax += Number(line.taxAmount);
      rates.set(key, current);
    }
    for (const [rate, values] of rates) {
      ticket.cols(`IVA ${rate} s/ ${ticket.money(values.base)}`, ticket.money(values.tax), { size: 8 });
    }
    ticket.cols('TOTAL', ticket.money(invoice.grossTotal), { bold: true, size: 12 });
    ticket.space();
    const qr = await QRCode.toBuffer(
      qrCodeContent({
        issuerTaxId: hotel.taxId,
        customerTaxId: invoice.customerTaxId,
        type: invoice.type,
        issuedAt: invoice.issuedAt,
        invoiceNo: invoice.fullNumber,
        atcud: invoice.atcud,
        lines: invoice.lines,
        taxTotal: invoice.taxTotal,
        grossTotal: invoice.grossTotal,
        signature: invoice.hash,
        certificateNumber: this.signing.certificateNumber,
      }),
      { errorCorrectionLevel: 'M', margin: 0, width: 300 },
    );
    ticket.image(qr, 110);
    ticket.space();
    ticket.text(
      this.signing.certified
        ? `${printedHash(invoice.hash)}-Processado por programa certificado n.o ${this.signing.certificateNumber}/AT`
        : `${printedHash(invoice.hash)}-Software nao certificado pela AT. Sem validade fiscal.`,
      { size: 7, align: 'center' },
    );
    if (invoice.type === 'INVOICE') ticket.text('Este documento nao serve de recibo.', { size: 7, align: 'center' });
    return this.render(ticket);
  }

  private rowHeight(doc: PDFKit.PDFDocument, row: Row) {
    switch (row.kind) {
      case 'rule':
        return 8;
      case 'space':
        return row.height ?? 6;
      case 'image':
        return row.size + 2;
      case 'text':
        doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(row.size ?? 9);
        return doc.heightOfString(row.text, { width: INNER }) + 2;
      case 'cols':
        doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(row.size ?? 9);
        return Math.max(doc.heightOfString(row.left, { width: INNER - 60 }), doc.heightOfString(row.right, { width: 60 })) + 2;
    }
  }

  private drawRow(doc: PDFKit.PDFDocument, row: Row, y: number) {
    const height = this.rowHeight(doc, row);
    switch (row.kind) {
      case 'rule':
        doc.moveTo(MARGIN, y + 3).lineTo(WIDTH - MARGIN, y + 3).dash(2, { space: 2 }).stroke('#000000').undash();
        break;
      case 'image':
        doc.image(row.buffer, (WIDTH - row.size) / 2, y, { width: row.size });
        break;
      case 'text':
        doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(row.size ?? 9);
        doc.text(row.text, MARGIN, y, { width: INNER, align: row.align ?? 'left' });
        break;
      case 'cols':
        doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(row.size ?? 9);
        doc.text(row.left, MARGIN, y, { width: INNER - 60 });
        doc.text(row.right, WIDTH - MARGIN - 60, y, { width: 60, align: 'right' });
        break;
      case 'space':
        break;
    }
    return y + height;
  }
}

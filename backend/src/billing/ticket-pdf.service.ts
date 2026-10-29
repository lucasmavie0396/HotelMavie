import { Injectable } from '@nestjs/common';
import { Hotel, PaperWidth } from '@prisma/client';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const PAPER: Record<PaperWidth, { width: number; margin: number; right: number; chars: number }> = {
  MM58: { width: 164.41, margin: 6, right: 52, chars: 32 },
  MM80: { width: 226.77, margin: 10, right: 62, chars: 48 },
  A4: { width: 595.28, margin: 50, right: 110, chars: 90 },
};
const A4_HEIGHT = 841.89;
const TIME_ZONE = process.env.AT_TIMEZONE ?? 'Europe/Lisbon';

type Row =
  | { kind: 'text'; text: string; size?: number; bold?: boolean; align?: 'left' | 'center' | 'right' }
  | { kind: 'cols'; left: string; right: string; size?: number; bold?: boolean }
  | { kind: 'rule' }
  | { kind: 'space'; height?: number }
  | { kind: 'qr'; data: string; size: number };

export interface TicketLine {
  quantity: { toString(): string };
  description: string;
  unitPrice?: { toString(): string };
  total?: { toString(): string };
  notes?: string | null;
  struck?: boolean;
}

export class Ticket {
  readonly rows: Row[] = [];

  constructor(readonly currency = 'EUR') {}

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

  qr(data: string, size = 110) {
    this.rows.push({ kind: 'qr', data, size });
    return this;
  }

  header(hotel: Hotel) {
    this.text(hotel.name, { bold: true, size: 12, align: 'center' });
    if (hotel.legalName && hotel.legalName !== hotel.name) this.text(hotel.legalName, { align: 'center', size: 8 });
    if (hotel.taxId) this.text(`NIF ${hotel.taxId}`, { align: 'center', size: 8 });
    const address = [hotel.address, [hotel.postalCode, hotel.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (address) this.text(address, { align: 'center', size: 8 });
    const contacts = [hotel.phone && `Tel. ${hotel.phone}`, hotel.email].filter(Boolean).join(' · ');
    if (contacts) this.text(contacts, { align: 'center', size: 8 });
    return this.rule();
  }

  footer(hotel: Hotel, operator?: string | null) {
    this.space();
    if (operator) this.text(`Atendido por: ${operator}`, { size: 8, align: 'center' });
    this.text(hotel.ticketFooter || 'Obrigado pela preferencia', { size: 8, align: 'center' });
    return this;
  }

  lines(items: TicketLine[], withPrices = true) {
    for (const item of items) {
      const quantity = Number(item.quantity.toString());
      const label = `${quantity} x ${item.description}${item.struck ? ' (ANULADO)' : ''}`;
      if (withPrices && item.total !== undefined) {
        this.cols(label, item.struck ? this.money(0) : this.money(item.total));
        if (item.unitPrice !== undefined && quantity !== 1) this.text(`   ${quantity} x ${this.money(item.unitPrice)}`, { size: 7 });
      } else {
        this.text(label, { size: 12, bold: true });
      }
      if (item.notes) this.text(`  > ${item.notes}`, { size: withPrices ? 8 : 10, bold: !withPrices });
    }
    return this;
  }

  static when(date: Date) {
    return date.toLocaleString('pt-PT', { timeZone: TIME_ZONE, dateStyle: 'short', timeStyle: 'short' });
  }

  static day(date: Date) {
    return date.toLocaleDateString('pt-PT', { timeZone: TIME_ZONE });
  }
}

function plain(text: string) {
  return text
    .replace(/€/g, 'EUR')
    .replace(/[  ]/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e\n]/g, '?');
}

function wrap(text: string, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (!line) line = word;
      else if ((line + ' ' + word).length <= width) line += ' ' + word;
      else {
        lines.push(line);
        line = word;
      }
      while (line.length > width) {
        lines.push(line.slice(0, width));
        line = line.slice(width);
      }
    }
    lines.push(line);
  }
  return lines;
}

@Injectable()
export class TicketPdfService {
  async render(ticket: Ticket, paper: PaperWidth = PaperWidth.MM80) {
    const spec = PAPER[paper];
    const qrImages = new Map<Row, Buffer>();
    for (const row of ticket.rows) {
      if (row.kind === 'qr') qrImages.set(row, await QRCode.toBuffer(row.data, { errorCorrectionLevel: 'M', margin: 0, width: 300 }));
    }
    const inner = spec.width - spec.margin * 2;
    const scale = paper === PaperWidth.A4 ? 1.15 : 1;
    const probe = new PDFDocument({ size: [spec.width, 1000], margin: spec.margin });
    const heights = ticket.rows.map((row) => this.rowHeight(probe, row, inner, spec.right, scale));
    probe.end();
    const total = heights.reduce((sum, h) => sum + h, spec.margin * 2) + 4;
    const pageHeight = paper === PaperWidth.A4 ? A4_HEIGHT : Math.ceil(total);

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: [spec.width, pageHeight], margin: spec.margin });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      let y = spec.margin;
      ticket.rows.forEach((row, index) => {
        if (y + heights[index] > pageHeight - spec.margin) {
          doc.addPage({ size: [spec.width, pageHeight], margin: spec.margin });
          y = spec.margin;
        }
        this.drawRow(doc, row, y, spec.margin, inner, spec.right, scale, qrImages.get(row));
        y += heights[index];
      });
      doc.end();
    });
  }

  escpos(ticket: Ticket, paper: PaperWidth = PaperWidth.MM80) {
    const width = paper === PaperWidth.MM58 ? 32 : 48;
    const out: number[] = [0x1b, 0x40];
    const push = (...bytes: number[]) => out.push(...bytes);
    const write = (text: string) => {
      for (const char of plain(text)) out.push(char.charCodeAt(0));
    };
    for (const row of ticket.rows) {
      const big = (row.kind === 'text' || row.kind === 'cols') && (row.size ?? 9) >= 12;
      const chars = big ? Math.floor(width / 2) : width;
      switch (row.kind) {
        case 'text':
          push(0x1b, 0x61, row.align === 'center' ? 1 : row.align === 'right' ? 2 : 0);
          push(0x1b, 0x45, row.bold ? 1 : 0);
          push(0x1d, 0x21, big ? 0x11 : 0x00);
          for (const line of wrap(row.text, chars)) {
            write(line);
            push(0x0a);
          }
          break;
        case 'cols': {
          push(0x1b, 0x61, 0, 0x1b, 0x45, row.bold ? 1 : 0, 0x1d, 0x21, big ? 0x11 : 0x00);
          const right = plain(row.right);
          const leftLines = wrap(row.left, Math.max(chars - right.length - 1, 8));
          leftLines.forEach((line, index) => {
            const content = index === leftLines.length - 1 ? `${plain(line)}${' '.repeat(Math.max(chars - plain(line).length - right.length, 1))}${right}` : plain(line);
            write(content);
            push(0x0a);
          });
          break;
        }
        case 'rule':
          push(0x1b, 0x61, 0, 0x1b, 0x45, 0, 0x1d, 0x21, 0);
          write('-'.repeat(width));
          push(0x0a);
          break;
        case 'space':
          push(0x0a);
          break;
        case 'qr': {
          const data = Buffer.from(row.data, 'utf8');
          const length = data.length + 3;
          push(0x1b, 0x61, 1);
          push(0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0);
          push(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, paper === PaperWidth.MM58 ? 4 : 5);
          push(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31);
          push(0x1d, 0x28, 0x6b, length & 0xff, length >> 8, 0x31, 0x50, 0x30, ...data);
          push(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30);
          push(0x0a);
          break;
        }
      }
    }
    push(0x1b, 0x61, 0, 0x1d, 0x21, 0, 0x1b, 0x45, 0);
    push(0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00);
    return Buffer.from(out);
  }

  private rowHeight(doc: PDFKit.PDFDocument, row: Row, inner: number, right: number, scale: number) {
    switch (row.kind) {
      case 'rule':
        return 8;
      case 'space':
        return row.height ?? 6;
      case 'qr':
        return row.size + 2;
      case 'text':
        doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize((row.size ?? 9) * scale);
        return doc.heightOfString(row.text, { width: inner }) + 2;
      case 'cols':
        doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize((row.size ?? 9) * scale);
        return Math.max(doc.heightOfString(row.left, { width: inner - right }), doc.heightOfString(row.right, { width: right })) + 2;
    }
  }

  private drawRow(doc: PDFKit.PDFDocument, row: Row, y: number, margin: number, inner: number, right: number, scale: number, image?: Buffer) {
    switch (row.kind) {
      case 'rule':
        doc.moveTo(margin, y + 3).lineTo(margin + inner, y + 3).dash(2, { space: 2 }).stroke('#000000').undash();
        break;
      case 'qr':
        if (image) doc.image(image, margin + (inner - row.size) / 2, y, { width: row.size });
        break;
      case 'text':
        doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize((row.size ?? 9) * scale);
        doc.text(row.text, margin, y, { width: inner, align: row.align ?? 'left' });
        break;
      case 'cols':
        doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize((row.size ?? 9) * scale);
        doc.text(row.left, margin, y, { width: inner - right });
        doc.text(row.right, margin + inner - right, y, { width: right, align: 'right' });
        break;
      case 'space':
        break;
    }
  }
}

import { Injectable } from '@nestjs/common';
import { Hotel, Invoice, InvoiceLine, InvoiceType, Prisma, Receipt } from '@prisma/client';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { printedHash, qrCodeContent, receiptQrContent } from '../at/at-format';
import { AtSigningService } from '../at/at-signing.service';
import { sumMoney } from '../common/money';
import { UploadsService } from '../uploads/uploads';
import { A4, COLORS, Column, drawFooter, drawHeader, drawSmallHeader, infoCard, loadLogo, rowHeight, sectionTitle, tableHeader, tableRow, totalsBox } from './a4-layout';

const TITLES: Record<InvoiceType, string> = {
  INVOICE: 'Fatura',
  INVOICE_RECEIPT: 'Fatura-Recibo',
  CREDIT_NOTE: 'Nota de Credito',
  RECEIPT: 'Recibo',
};

type FullInvoice = Invoice & { lines: InvoiceLine[]; creditOf: { fullNumber: string } | null };

type FullReceipt = Receipt & { lines: { amount: Prisma.Decimal; invoice: { fullNumber: string; issuedAt: Date; grossTotal: Prisma.Decimal } }[] };

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Numerario',
  CARD: 'Cartao',
  TRANSFER: 'Transferencia',
  MOBILE: 'Pagamento movel',
  OTHER: 'Outro',
};

const FISCAL_AREA = 150;

@Injectable()
export class InvoicePdfService {
  constructor(
    private readonly signing: AtSigningService,
    private readonly uploads: UploadsService,
  ) {}

  private document(title: string, author: string) {
    const doc = new PDFDocument({ size: 'A4', margins: { top: A4.margin, bottom: 20, left: A4.margin, right: A4.margin }, bufferPages: true, info: { Title: title, Author: author } });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    return { doc, done };
  }

  private fiscalBlock(doc: PDFKit.PDFDocument, qr: Buffer, lines: { text: string; strong?: boolean }[]) {
    const left = A4.margin;
    const width = doc.page.width - A4.margin * 2;
    const top = doc.page.height - FISCAL_AREA + 10;
    doc.roundedRect(left, top, width, 100, 8).fill(COLORS.zebra);
    doc.image(qr, left + 10, top + 10, { width: 80 });
    let y = top + 12;
    for (const line of lines) {
      doc.fillColor(line.strong ? COLORS.ink : COLORS.muted).font(line.strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5);
      doc.text(line.text, left + 104, y, { width: width - 116 });
      y = doc.y + 3;
    }
  }

  private footers(doc: PDFKit.PDFDocument, hotel: Hotel) {
    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index++) {
      doc.switchToPage(index);
      drawFooter(doc, [hotel.name, hotel.phone, hotel.email].filter(Boolean).join(' · '), `Pagina ${index - range.start + 1} de ${range.count}`);
    }
  }

  async renderReceipt(receipt: FullReceipt, hotel: Hotel) {
    const qr = await QRCode.toBuffer(
      receiptQrContent({
        issuerTaxId: hotel.taxId,
        customerTaxId: receipt.customerTaxId,
        issuedAt: receipt.issuedAt,
        receiptNo: receipt.fullNumber,
        atcud: receipt.atcud,
        amount: receipt.amount,
        certificateNumber: this.signing.certificateNumber,
        cancelled: receipt.status === 'CANCELLED',
      }),
      { errorCorrectionLevel: 'M', margin: 0, width: 240 },
    );
    const certified = this.signing.certified;
    const certificate = this.signing.certificateNumber;
    const timeZone = process.env.AT_TIMEZONE ?? 'Europe/Lisbon';
    const logo = await loadLogo(this.uploads, hotel);

    const { doc, done } = this.document(`Recibo ${receipt.fullNumber}`, hotel.name);
    const money = (value: { toString(): string }) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: hotel.currency }).format(Number(value.toString()));
    const left = A4.margin;
    const width = doc.page.width - A4.margin * 2;

    let y = drawHeader(doc, {
      hotel,
      logo,
      title: 'Recibo',
      meta: [`N.o ${receipt.fullNumber}`, `Data: ${receipt.issuedAt.toLocaleString('pt-PT', { timeZone })}`, `ATCUD: ${receipt.atcud ?? '0 (serie por comunicar a AT)'}`],
      alert: receipt.status === 'CANCELLED' ? `ANULADO: ${receipt.cancelReason ?? ''}` : null,
    });

    const half = (width - 14) / 2;
    y =
      Math.max(
        infoCard(doc, left, y, half, 'Cliente', [
          ['Nome', receipt.customerName],
          ['NIF', receipt.customerTaxId ?? 'Consumidor final'],
        ]),
        infoCard(doc, left + half + 14, y, half, 'Pagamento', [
          ['Meio', METHOD_LABELS[receipt.method]],
          ['Referencia', receipt.reference ?? '-'],
          ['Valor', money(receipt.amount)],
        ]),
      ) + 18;

    y = sectionTitle(doc, 'Documentos liquidados', left, y, width);
    const columns: Column[] = [
      { label: 'Documento liquidado', width: width - 330 },
      { label: 'Data', width: 100 },
      { label: 'Valor do documento', width: 115, align: 'right' },
      { label: 'Valor pago', width: 115, align: 'right' },
    ];
    y = tableHeader(doc, left, y, columns);
    receipt.lines.forEach((line, index) => {
      if (y + 24 > doc.page.height - FISCAL_AREA) {
        doc.addPage();
        y = tableHeader(doc, left, drawSmallHeader(doc, hotel.name, `Recibo ${receipt.fullNumber}`), columns);
      }
      y = tableRow(doc, left, y, columns, [line.invoice.fullNumber, line.invoice.issuedAt.toLocaleDateString('pt-PT', { timeZone }), money(line.invoice.grossTotal), money(line.amount)], index);
    });

    y += 14;
    if (y + 60 > doc.page.height - FISCAL_AREA) {
      doc.addPage();
      y = drawSmallHeader(doc, hotel.name, `Recibo ${receipt.fullNumber}`);
    }
    totalsBox(doc, left + width - 230, y, 230, [{ label: 'Total recebido', value: money(receipt.amount), strong: true }]);

    this.fiscalBlock(doc, qr, [
      {
        text: certified ? `Processado por programa certificado n.o ${certificate}/AT` : 'Documento emitido por software nao certificado pela Autoridade Tributaria. Sem validade fiscal.',
        strong: true,
      },
    ]);
    this.footers(doc, hotel);
    doc.end();
    return done;
  }

  async render(invoice: FullInvoice, hotel: Hotel) {
    const qrContent = qrCodeContent({
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
    });
    const qr = await QRCode.toBuffer(qrContent, { errorCorrectionLevel: 'M', margin: 0, width: 240 });
    const hashMark = printedHash(invoice.hash);
    const certified = this.signing.certified;
    const certificate = this.signing.certificateNumber;
    const timeZone = process.env.AT_TIMEZONE ?? 'Europe/Lisbon';
    const logo = await loadLogo(this.uploads, hotel);
    const title = TITLES[invoice.type];

    const { doc, done } = this.document(`${title} ${invoice.fullNumber}`, hotel.name);
    const money = (value: { toString(): string }) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: invoice.currency }).format(Number(value));
    const left = A4.margin;
    const width = doc.page.width - A4.margin * 2;

    const meta = [`N.o ${invoice.fullNumber}`, `Data: ${invoice.issuedAt.toLocaleString('pt-PT', { timeZone })}`, `ATCUD: ${invoice.atcud ?? '0 (serie por comunicar a AT)'}`];
    if (invoice.creditOf) meta.push(`Referente a: ${invoice.creditOf.fullNumber}`);
    let y = drawHeader(doc, { hotel, logo, title, meta });

    const customerRows: [string, string][] = [
      ['Nome', invoice.customerName],
      ['NIF', invoice.customerTaxId ?? 'Consumidor final'],
    ];
    if (invoice.customerAddress) customerRows.push(['Morada', invoice.customerAddress]);
    const documentRows: [string, string][] = [
      ['Documento', `${title} ${invoice.fullNumber}`],
      ['Moeda', invoice.currency],
    ];
    if (invoice.creditOf) documentRows.push(['Referente a', invoice.creditOf.fullNumber]);
    if (invoice.reason) documentRows.push(['Motivo', invoice.reason]);
    const half = (width - 14) / 2;
    y = Math.max(infoCard(doc, left, y, half, 'Cliente', customerRows), infoCard(doc, left + half + 14, y, half, 'Documento', documentRows)) + 18;

    y = sectionTitle(doc, 'Detalhe', left, y, width);
    const columns: Column[] = [
      { label: 'Descricao', width: width - 290 },
      { label: 'Qtd', width: 45, align: 'right' },
      { label: 'Preco', width: 70, align: 'right' },
      { label: 'IVA', width: 45, align: 'right' },
      { label: 'Base', width: 65, align: 'right' },
      { label: 'Total', width: 65, align: 'right' },
    ];
    const continued = () => {
      doc.addPage();
      return drawSmallHeader(doc, hotel.name, `${title} ${invoice.fullNumber}`);
    };
    y = tableHeader(doc, left, y, columns);
    invoice.lines.forEach((line, index) => {
      const cells = [
        line.description,
        Number(line.quantity).toLocaleString('pt-PT'),
        money(line.unitPrice),
        `${Number(line.taxRate)}%`,
        money(line.netAmount),
        money(line.grossAmount),
      ];
      const needed = rowHeight(doc, columns, cells) + (line.exemptionReason ? 12 : 0);
      if (y + needed > doc.page.height - FISCAL_AREA) y = tableHeader(doc, left, continued(), columns);
      y = tableRow(doc, left, y, columns, cells, index);
      if (line.exemptionReason) {
        doc.fillColor(COLORS.muted).font('Helvetica-Oblique').fontSize(7).text(`Isencao: ${line.exemptionReason}`, left + 5, y + 2, { width: width - 10 });
        y = doc.y + 3;
      }
    });

    const byRate = new Map<string, InvoiceLine[]>();
    for (const line of invoice.lines) {
      const key = Number(line.taxRate).toString();
      byRate.set(key, [...(byRate.get(key) ?? []), line]);
    }
    y += 16;
    const blockHeight = Math.max(40 + byRate.size * 20, 100);
    if (y + blockHeight > doc.page.height - FISCAL_AREA) y = continued();

    const taxColumns: Column[] = [
      { label: 'Taxa IVA', width: 70 },
      { label: 'Base', width: 95, align: 'right' },
      { label: 'IVA', width: 95, align: 'right' },
    ];
    let ty = sectionTitle(doc, 'Resumo do IVA', left, y, 260);
    ty = tableHeader(doc, left, ty, taxColumns, 8);
    [...byRate].forEach(([rate, lines], index) => {
      ty = tableRow(doc, left, ty, taxColumns, [`${rate}%`, money(sumMoney(lines.map((l) => l.netAmount))), money(sumMoney(lines.map((l) => l.taxAmount)))], index, { fontSize: 8 });
    });

    totalsBox(doc, left + width - 220, y, 220, [
      { label: 'Total sem IVA', value: money(invoice.netTotal) },
      { label: 'Total IVA', value: money(invoice.taxTotal) },
      { label: 'Total', value: money(invoice.grossTotal), strong: true },
    ]);

    const fiscal: { text: string; strong?: boolean }[] = [];
    if (hotel.invoiceFooter) fiscal.push({ text: hotel.invoiceFooter });
    fiscal.push({
      text: certified
        ? `${hashMark}-Processado por programa certificado n.o ${certificate}/AT`
        : `${hashMark}-Documento emitido por software nao certificado pela Autoridade Tributaria. Sem validade fiscal.`,
      strong: true,
    });
    if (invoice.type === 'INVOICE') fiscal.push({ text: 'Este documento nao serve de recibo.' });
    this.fiscalBlock(doc, qr, fiscal);
    this.footers(doc, hotel);
    doc.end();
    return done;
  }
}

import { Injectable } from '@nestjs/common';
import { Hotel, Invoice, InvoiceLine, InvoiceType, Prisma, Receipt } from '@prisma/client';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { printedHash, qrCodeContent, receiptQrContent } from '../at/at-format';
import { AtSigningService } from '../at/at-signing.service';
import { sumMoney } from '../common/money';
import { MailLang } from '../mail/templates';
import { UploadsService } from '../uploads/uploads';
import { A4, COLORS, Column, drawFooter, drawHeader, drawSmallHeader, infoCard, loadLogo, rowHeight, sectionTitle, tableHeader, tableRow, totalsBox } from './a4-layout';

type FullInvoice = Invoice & { lines: InvoiceLine[]; creditOf: { fullNumber: string } | null };

type FullReceipt = Receipt & { lines: { amount: Prisma.Decimal; invoice: { fullNumber: string; issuedAt: Date; grossTotal: Prisma.Decimal } }[] };

const LABELS = {
  pt: {
    titles: { INVOICE: 'Fatura', INVOICE_RECEIPT: 'Fatura-Recibo', CREDIT_NOTE: 'Nota de Credito', RECEIPT: 'Recibo' } as Record<InvoiceType, string>,
    methods: { CASH: 'Numerario', CARD: 'Cartao', TRANSFER: 'Transferencia', MOBILE: 'Pagamento movel', OTHER: 'Outro' } as Record<string, string>,
    number: 'N.o',
    date: 'Data',
    pendingSeries: '0 (serie por comunicar a AT)',
    cancelled: 'ANULADO',
    customer: 'Cliente',
    name: 'Nome',
    taxId: 'NIF',
    finalConsumer: 'Consumidor final',
    address: 'Morada',
    payment: 'Pagamento',
    method: 'Meio',
    reference: 'Referencia',
    value: 'Valor',
    settled: 'Documentos liquidados',
    settledDocument: 'Documento liquidado',
    documentValue: 'Valor do documento',
    paid: 'Valor pago',
    totalReceived: 'Total recebido',
    document: 'Documento',
    currency: 'Moeda',
    creditOf: 'Referente a',
    reason: 'Motivo',
    detail: 'Detalhe',
    description: 'Descricao',
    qty: 'Qtd',
    price: 'Preco',
    vat: 'IVA',
    net: 'Base',
    total: 'Total',
    exemption: 'Isencao',
    vatRate: 'Taxa IVA',
    vatSummary: 'Resumo do IVA',
    totalNet: 'Total sem IVA',
    totalVat: 'Total IVA',
    page: (index: number, count: number) => `Pagina ${index} de ${count}`,
  },
  en: {
    titles: { INVOICE: 'Fatura / Invoice', INVOICE_RECEIPT: 'Fatura-Recibo / Invoice-Receipt', CREDIT_NOTE: 'Nota de Credito / Credit Note', RECEIPT: 'Recibo / Receipt' } as Record<InvoiceType, string>,
    methods: { CASH: 'Cash', CARD: 'Card', TRANSFER: 'Bank transfer', MOBILE: 'Mobile payment', OTHER: 'Other' } as Record<string, string>,
    number: 'No.',
    date: 'Date',
    pendingSeries: '0 (series not yet registered with the AT)',
    cancelled: 'CANCELLED',
    customer: 'Customer',
    name: 'Name',
    taxId: 'Tax no.',
    finalConsumer: 'Final consumer',
    address: 'Address',
    payment: 'Payment',
    method: 'Method',
    reference: 'Reference',
    value: 'Amount',
    settled: 'Settled documents',
    settledDocument: 'Settled document',
    documentValue: 'Document amount',
    paid: 'Amount paid',
    totalReceived: 'Total received',
    document: 'Document',
    currency: 'Currency',
    creditOf: 'Refers to',
    reason: 'Reason',
    detail: 'Details',
    description: 'Description',
    qty: 'Qty',
    price: 'Price',
    vat: 'VAT',
    net: 'Net',
    total: 'Total',
    exemption: 'Exemption',
    vatRate: 'VAT rate',
    vatSummary: 'VAT summary',
    totalNet: 'Total excl. VAT',
    totalVat: 'Total VAT',
    page: (index: number, count: number) => `Page ${index} of ${count}`,
  },
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

  private footers(doc: PDFKit.PDFDocument, hotel: Hotel, lang: MailLang) {
    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index++) {
      doc.switchToPage(index);
      drawFooter(doc, [hotel.name, hotel.phone, hotel.email].filter(Boolean).join(' · '), LABELS[lang].page(index - range.start + 1, range.count));
    }
  }

  private formats(lang: MailLang, currency: string) {
    const tag = lang === 'en' ? 'en-GB' : 'pt-PT';
    return {
      tag,
      money: (value: { toString(): string }) => new Intl.NumberFormat(tag, { style: 'currency', currency }).format(Number(value.toString())),
    };
  }

  async renderReceipt(receipt: FullReceipt, hotel: Hotel, lang: MailLang = 'pt') {
    const text = LABELS[lang];
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
    const { tag, money } = this.formats(lang, hotel.currency);
    const title = text.titles.RECEIPT;

    const { doc, done } = this.document(`${title} ${receipt.fullNumber}`, hotel.name);
    const left = A4.margin;
    const width = doc.page.width - A4.margin * 2;

    let y = drawHeader(doc, {
      hotel,
      logo,
      title,
      meta: [`${text.number} ${receipt.fullNumber}`, `${text.date}: ${receipt.issuedAt.toLocaleString(tag, { timeZone })}`, `ATCUD: ${receipt.atcud ?? text.pendingSeries}`],
      alert: receipt.status === 'CANCELLED' ? `${text.cancelled}: ${receipt.cancelReason ?? ''}` : null,
    });

    const half = (width - 14) / 2;
    y =
      Math.max(
        infoCard(doc, left, y, half, text.customer, [
          [text.name, receipt.customerName],
          [text.taxId, receipt.customerTaxId ?? text.finalConsumer],
        ]),
        infoCard(doc, left + half + 14, y, half, text.payment, [
          [text.method, text.methods[receipt.method]],
          [text.reference, receipt.reference ?? '-'],
          [text.value, money(receipt.amount)],
        ]),
      ) + 18;

    y = sectionTitle(doc, text.settled, left, y, width);
    const columns: Column[] = [
      { label: text.settledDocument, width: width - 330 },
      { label: text.date, width: 100 },
      { label: text.documentValue, width: 115, align: 'right' },
      { label: text.paid, width: 115, align: 'right' },
    ];
    y = tableHeader(doc, left, y, columns);
    receipt.lines.forEach((line, index) => {
      if (y + 24 > doc.page.height - FISCAL_AREA) {
        doc.addPage();
        y = tableHeader(doc, left, drawSmallHeader(doc, hotel.name, `${title} ${receipt.fullNumber}`), columns);
      }
      y = tableRow(doc, left, y, columns, [line.invoice.fullNumber, line.invoice.issuedAt.toLocaleDateString(tag, { timeZone }), money(line.invoice.grossTotal), money(line.amount)], index);
    });

    y += 14;
    if (y + 60 > doc.page.height - FISCAL_AREA) {
      doc.addPage();
      y = drawSmallHeader(doc, hotel.name, `${title} ${receipt.fullNumber}`);
    }
    totalsBox(doc, left + width - 230, y, 230, [{ label: text.totalReceived, value: money(receipt.amount), strong: true }]);

    this.fiscalBlock(doc, qr, [
      {
        text: certified ? `Processado por programa certificado n.o ${certificate}/AT` : 'Documento emitido por software nao certificado pela Autoridade Tributaria. Sem validade fiscal.',
        strong: true,
      },
    ]);
    this.footers(doc, hotel, lang);
    doc.end();
    return done;
  }

  async render(invoice: FullInvoice, hotel: Hotel, lang: MailLang = 'pt') {
    const text = LABELS[lang];
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
    const title = text.titles[invoice.type];
    const { tag, money } = this.formats(lang, invoice.currency);

    const { doc, done } = this.document(`${title} ${invoice.fullNumber}`, hotel.name);
    const left = A4.margin;
    const width = doc.page.width - A4.margin * 2;

    const meta = [`${text.number} ${invoice.fullNumber}`, `${text.date}: ${invoice.issuedAt.toLocaleString(tag, { timeZone })}`, `ATCUD: ${invoice.atcud ?? text.pendingSeries}`];
    if (invoice.creditOf) meta.push(`${text.creditOf}: ${invoice.creditOf.fullNumber}`);
    let y = drawHeader(doc, { hotel, logo, title, meta });

    const customerRows: [string, string][] = [
      [text.name, invoice.customerName],
      [text.taxId, invoice.customerTaxId ?? text.finalConsumer],
    ];
    if (invoice.customerAddress) customerRows.push([text.address, invoice.customerAddress]);
    const documentRows: [string, string][] = [
      [text.document, `${title} ${invoice.fullNumber}`],
      [text.currency, invoice.currency],
    ];
    if (invoice.creditOf) documentRows.push([text.creditOf, invoice.creditOf.fullNumber]);
    if (invoice.reason) documentRows.push([text.reason, invoice.reason]);
    const half = (width - 14) / 2;
    y = Math.max(infoCard(doc, left, y, half, text.customer, customerRows), infoCard(doc, left + half + 14, y, half, text.document, documentRows)) + 18;

    y = sectionTitle(doc, text.detail, left, y, width);
    const columns: Column[] = [
      { label: text.description, width: width - 290 },
      { label: text.qty, width: 45, align: 'right' },
      { label: text.price, width: 70, align: 'right' },
      { label: text.vat, width: 45, align: 'right' },
      { label: text.net, width: 65, align: 'right' },
      { label: text.total, width: 65, align: 'right' },
    ];
    const continued = () => {
      doc.addPage();
      return drawSmallHeader(doc, hotel.name, `${title} ${invoice.fullNumber}`);
    };
    y = tableHeader(doc, left, y, columns);
    invoice.lines.forEach((line, index) => {
      const cells = [
        line.description,
        Number(line.quantity).toLocaleString(tag),
        money(line.unitPrice),
        `${Number(line.taxRate)}%`,
        money(line.netAmount),
        money(line.grossAmount),
      ];
      const needed = rowHeight(doc, columns, cells) + (line.exemptionReason ? 12 : 0);
      if (y + needed > doc.page.height - FISCAL_AREA) y = tableHeader(doc, left, continued(), columns);
      y = tableRow(doc, left, y, columns, cells, index);
      if (line.exemptionReason) {
        doc.fillColor(COLORS.muted).font('Helvetica-Oblique').fontSize(7).text(`${text.exemption}: ${line.exemptionReason}`, left + 5, y + 2, { width: width - 10 });
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
      { label: text.vatRate, width: 70 },
      { label: text.net, width: 95, align: 'right' },
      { label: text.vat, width: 95, align: 'right' },
    ];
    let ty = sectionTitle(doc, text.vatSummary, left, y, 260);
    ty = tableHeader(doc, left, ty, taxColumns, 8);
    [...byRate].forEach(([rate, lines], index) => {
      ty = tableRow(doc, left, ty, taxColumns, [`${rate}%`, money(sumMoney(lines.map((l) => l.netAmount))), money(sumMoney(lines.map((l) => l.taxAmount)))], index, { fontSize: 8 });
    });

    totalsBox(doc, left + width - 220, y, 220, [
      { label: text.totalNet, value: money(invoice.netTotal) },
      { label: text.totalVat, value: money(invoice.taxTotal) },
      { label: text.total, value: money(invoice.grossTotal), strong: true },
    ]);

    const fiscal: { text: string; strong?: boolean }[] = [];
    if (hotel.invoiceFooter) fiscal.push({ text: hotel.invoiceFooter });
    fiscal.push({
      text: certified
        ? `${hashMark}-Processado por programa certificado n.o ${certificate}/AT`
        : `${hashMark}-Documento emitido por software nao certificado pela Autoridade Tributaria. Sem validade fiscal.`,
      strong: true,
    });
    if (invoice.type === 'INVOICE') fiscal.push({ text: lang === 'en' ? 'Este documento nao serve de recibo. / This document is not a receipt.' : 'Este documento nao serve de recibo.' });
    this.fiscalBlock(doc, qr, fiscal);
    this.footers(doc, hotel, lang);
    doc.end();
    return done;
  }
}

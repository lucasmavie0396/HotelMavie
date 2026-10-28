import { Injectable } from '@nestjs/common';
import { Hotel, Invoice, InvoiceLine, InvoiceType } from '@prisma/client';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { printedHash, qrCodeContent } from '../at/at-format';
import { AtSigningService } from '../at/at-signing.service';
import { sumMoney } from '../common/money';

const TITLES: Record<InvoiceType, string> = {
  INVOICE: 'Fatura',
  INVOICE_RECEIPT: 'Fatura-Recibo',
  CREDIT_NOTE: 'Nota de Credito',
};

type FullInvoice = Invoice & { lines: InvoiceLine[]; creditOf: { fullNumber: string } | null };

@Injectable()
export class InvoicePdfService {
  constructor(private readonly signing: AtSigningService) {}

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

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const money = (value: { toString(): string }) =>
        new Intl.NumberFormat('pt-PT', { style: 'currency', currency: invoice.currency }).format(Number(value));
      const left = 50;
      const width = doc.page.width - 100;

      doc.fontSize(16).font('Helvetica-Bold').text(hotel.legalName ?? hotel.name, left, 50);
      doc.fontSize(9).font('Helvetica');
      if (hotel.taxId) doc.text(`NIF: ${hotel.taxId}`);
      if (hotel.address) doc.text(hotel.address);
      if (hotel.phone || hotel.email) doc.text([hotel.phone, hotel.email].filter(Boolean).join(' · '));

      doc.fontSize(14).font('Helvetica-Bold').text(`${TITLES[invoice.type]} ${invoice.fullNumber}`, left, 50, { width, align: 'right' });
      doc.fontSize(9).font('Helvetica').text(`Data: ${invoice.issuedAt.toLocaleString('pt-PT', { timeZone: process.env.AT_TIMEZONE ?? 'Europe/Lisbon' })}`, { width, align: 'right' });
      doc.text(`ATCUD: ${invoice.atcud ?? '0 (serie por comunicar a AT)'}`, { width, align: 'right' });
      if (invoice.creditOf) doc.text(`Referente a: ${invoice.creditOf.fullNumber}`, { width, align: 'right' });
      if (invoice.reason) doc.text(`Motivo: ${invoice.reason}`, { width, align: 'right' });

      doc.moveDown(3);
      const customerTop = Math.max(doc.y, 140);
      doc.font('Helvetica-Bold').text('Cliente', left, customerTop);
      doc.font('Helvetica').text(invoice.customerName);
      doc.text(`NIF: ${invoice.customerTaxId ?? 'Consumidor final'}`);
      if (invoice.customerAddress) doc.text(invoice.customerAddress);

      const columns = [
        { label: 'Descricao', x: left, w: 220, align: 'left' as const },
        { label: 'Qtd', x: left + 220, w: 45, align: 'right' as const },
        { label: 'Preco', x: left + 265, w: 70, align: 'right' as const },
        { label: 'IVA', x: left + 335, w: 45, align: 'right' as const },
        { label: 'Base', x: left + 380, w: 60, align: 'right' as const },
        { label: 'Total', x: left + 440, w: 55, align: 'right' as const },
      ];
      let y = doc.y + 20;
      doc.font('Helvetica-Bold');
      for (const column of columns) doc.text(column.label, column.x, y, { width: column.w, align: column.align });
      y += 15;
      doc.moveTo(left, y - 3).lineTo(left + width, y - 3).stroke('#cccccc');
      doc.font('Helvetica');

      for (const line of invoice.lines) {
        if (y > doc.page.height - 150) {
          doc.addPage();
          y = 50;
        }
        const values = [
          line.description,
          Number(line.quantity).toLocaleString('pt-PT'),
          money(line.unitPrice),
          `${Number(line.taxRate)}%`,
          money(line.netAmount),
          money(line.grossAmount),
        ];
        const height = doc.heightOfString(line.description, { width: columns[0].w });
        columns.forEach((column, index) => doc.text(values[index], column.x, y, { width: column.w, align: column.align }));
        y += Math.max(height, 12) + 4;
        if (line.exemptionReason) {
          doc.fontSize(7).fillColor('#666666').text(`Isencao: ${line.exemptionReason}`, left, y - 2, { width: 300 });
          doc.fontSize(9).fillColor('#000000');
          y += 10;
        }
      }

      y += 10;
      doc.moveTo(left, y).lineTo(left + width, y).stroke('#cccccc');
      y += 10;
      const byRate = new Map<string, InvoiceLine[]>();
      for (const line of invoice.lines) {
        const key = Number(line.taxRate).toString();
        byRate.set(key, [...(byRate.get(key) ?? []), line]);
      }
      doc.font('Helvetica-Bold').text('Resumo do IVA', left, y);
      y += 14;
      doc.font('Helvetica');
      for (const [rate, lines] of byRate) {
        doc.text(
          `${rate}% · base ${money(sumMoney(lines.map((l) => l.netAmount)))} · IVA ${money(sumMoney(lines.map((l) => l.taxAmount)))}`,
          left,
          y,
        );
        y += 12;
      }

      const totalsX = left + width - 200;
      let ty = y - 12 * byRate.size - 14;
      for (const [label, value, bold] of [
        ['Total sem IVA', invoice.netTotal, false],
        ['Total IVA', invoice.taxTotal, false],
        ['Total', invoice.grossTotal, true],
      ] as const) {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 9);
        doc.text(label, totalsX, ty, { width: 100 });
        doc.text(money(value), totalsX + 100, ty, { width: 100, align: 'right' });
        ty += bold ? 18 : 13;
      }

      const footerY = doc.page.height - 145;
      doc.image(qr, left, footerY, { width: 85 });
      doc.fontSize(7).font('Helvetica').fillColor('#666666');
      const textX = left + 100;
      const textWidth = width - 100;
      if (hotel.invoiceFooter) doc.text(hotel.invoiceFooter, textX, footerY, { width: textWidth });
      doc.text(
        certified
          ? `${hashMark}-Processado por programa certificado n.o ${certificate}/AT`
          : `${hashMark}-Documento emitido por software nao certificado pela Autoridade Tributaria. Sem validade fiscal.`,
        textX,
        footerY + 55,
        { width: textWidth, lineBreak: false },
      );
      if (invoice.type === 'INVOICE') {
        doc.text('Este documento nao serve de recibo.', textX, footerY + 67, { width: textWidth, lineBreak: false });
      }
      doc.end();
    });
  }
}

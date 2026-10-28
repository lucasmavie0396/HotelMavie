import { Injectable } from '@nestjs/common';
import { Hotel, Invoice, InvoiceLine, InvoiceType } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { sumMoney } from '../common/money';

const TITLES: Record<InvoiceType, string> = {
  INVOICE: 'Fatura',
  INVOICE_RECEIPT: 'Fatura-Recibo',
  CREDIT_NOTE: 'Nota de Credito',
};

type FullInvoice = Invoice & { lines: InvoiceLine[]; creditOf: { fullNumber: string } | null };

@Injectable()
export class InvoicePdfService {
  render(invoice: FullInvoice, hotel: Hotel) {
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
      doc.fontSize(9).font('Helvetica').text(`Data: ${invoice.issuedAt.toLocaleString('pt-PT')}`, { width, align: 'right' });
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

      doc.fontSize(7).font('Helvetica').fillColor('#666666');
      const footerY = doc.page.height - 90;
      if (hotel.invoiceFooter) doc.text(hotel.invoiceFooter, left, footerY - 20, { width });
      doc.text(`Hash: ${invoice.hash.slice(0, 4)}...${invoice.hash.slice(-4)}`, left, footerY, { width });
      doc.text('Documento emitido por software nao certificado pela Autoridade Tributaria. Sem validade fiscal.', left, footerY + 10, {
        width,
      });
      doc.end();
    });
  }
}

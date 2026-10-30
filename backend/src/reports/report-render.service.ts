import { Injectable } from '@nestjs/common';
import { Hotel, PaperWidth } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { band, drawFooter, drawHeader, drawSmallHeader, sectionTitle } from '../billing/a4-layout';
import { Ticket, TicketPdfService } from '../billing/ticket-pdf.service';
import { UploadsService } from '../uploads/uploads';
import { Report, ReportTable } from './report-model';

const ACCENT = '#4338ca';
const INK = '#0f172a';
const MUTED = '#64748b';
const MARGIN = 40;

@Injectable()
export class ReportRenderService {
  constructor(
    private readonly uploads: UploadsService,
    private readonly tickets: TicketPdfService,
  ) {}

  async pdf(report: Report, paper: PaperWidth) {
    if (paper === PaperWidth.A4) return this.a4(report);
    return this.tickets.render(await this.ticket(report), paper);
  }

  async ticket(report: Report) {
    const ticket = new Ticket(report.hotel.currency);
    const logo = await this.logo(report.hotel);
    if (logo) ticket.image(logo, 80).space(2);
    ticket.header(report.hotel);
    ticket.text(report.title.toUpperCase(), { bold: true, size: 11, align: 'center' });
    ticket.text(report.period, { size: 8, align: 'center' });
    ticket.rule();
    for (const section of report.sections) {
      ticket.text(section.title.toUpperCase(), { bold: true, size: 9 });
      for (const kpi of section.kpis ?? []) ticket.cols(kpi.label, kpi.value, { size: 8 });
      if (section.table) this.ticketTable(ticket, section.table);
      if (section.note) ticket.text(section.note, { size: 7 });
      ticket.rule();
    }
    ticket.text(`Gerado em ${report.generatedAt} por ${report.generatedBy}`, { size: 7, align: 'center' });
    return ticket;
  }

  private ticketTable(ticket: Ticket, table: ReportTable) {
    if (!table.rows.length) {
      ticket.text(table.empty ?? 'Sem dados', { size: 8 });
      return;
    }
    const right = table.columns.map((column, index) => (column.align === 'right' ? index : -1)).filter((index) => index >= 0);
    const main = right.length ? right[right.length - 1] : -1;
    const extra = right.slice(0, -1);
    const leftColumns = table.columns.map((_, index) => index).filter((index) => !right.includes(index));
    const line = (cells: string[], bold = false) => {
      const left = leftColumns.map((index) => cells[index]).filter((value) => value && value !== '-').join(' · ');
      if (main >= 0) ticket.cols(left || table.columns[0].label, cells[main], { size: 8, bold });
      else ticket.text(left, { size: 8, bold });
      const details = extra.filter((index) => cells[index]).map((index) => `${table.columns[index].label}: ${cells[index]}`);
      if (details.length) ticket.text(`   ${details.join(' · ')}`, { size: 7 });
    };
    for (const row of table.rows) line(row);
    if (table.totals) line(table.totals, true);
  }

  private async logo(hotel: Hotel) {
    if (!hotel.logoFile) return null;
    try {
      return (await this.uploads.read(hotel.logoFile)).bytes;
    } catch {
      return null;
    }
  }

  private async a4(report: Report) {
    const logo = await this.logo(report.hotel);
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: MARGIN, bottom: 0, left: MARGIN, right: MARGIN },
        bufferPages: true,
        info: { Title: `${report.title} - ${report.hotel.name}`, Author: report.hotel.name },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const width = doc.page.width - MARGIN * 2;
      const bottom = doc.page.height - 60;
      let y = this.header(doc, report, logo);

      const newPage = () => {
        doc.addPage({ size: 'A4', margins: { top: MARGIN, bottom: 0, left: MARGIN, right: MARGIN } });
        y = this.smallHeader(doc, report);
        return y;
      };
      const ensure = (height: number) => {
        if (y + height > bottom) newPage();
      };

      for (const section of report.sections) {
        ensure(60);
        y = sectionTitle(doc, section.title, MARGIN, y, width);

        if (section.kpis?.length) {
          const perRow = Math.min(4, section.kpis.length);
          const gap = 8;
          const boxWidth = (width - gap * (perRow - 1)) / perRow;
          const boxHeight = 42;
          section.kpis.forEach((kpi, index) => {
            const column = index % perRow;
            if (column === 0) {
              if (index > 0) y += boxHeight + gap;
              ensure(boxHeight);
            }
            const x = MARGIN + column * (boxWidth + gap);
            doc.roundedRect(x, y, boxWidth, boxHeight, 6).fill('#eef2ff');
            doc.rect(x, y + 6, 3, boxHeight - 12).fill(ACCENT);
            doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(kpi.label.toUpperCase(), x + 10, y + 8, { width: boxWidth - 16, height: 9, ellipsis: true });
            doc.fillColor(INK).font('Helvetica-Bold').fontSize(12.5).text(kpi.value, x + 10, y + 20, { width: boxWidth - 16, height: 15, ellipsis: true });
          });
          y += boxHeight + 12;
        }

        if (section.table) {
          y = this.table(doc, section.table, y, width, bottom, newPage);
        }

        if (section.note) {
          ensure(20);
          doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(7.5).text(section.note, MARGIN, y, { width });
          y = doc.y + 4;
        }
        y += 14;
      }

      const range = doc.bufferedPageRange();
      for (let index = range.start; index < range.start + range.count; index++) {
        doc.switchToPage(index);
        drawFooter(doc, `${report.hotel.name} · ${report.title} · gerado em ${report.generatedAt} por ${report.generatedBy}`, `Pagina ${index - range.start + 1} de ${range.count}`, MARGIN);
      }
      doc.end();
    });
  }

  private header(doc: PDFKit.PDFDocument, report: Report, logo: Buffer | null) {
    return drawHeader(doc, {
      hotel: report.hotel,
      logo,
      title: report.title,
      meta: [report.period, `Emitido em ${report.generatedAt}`, `Por ${report.generatedBy}`],
      margin: MARGIN,
    });
  }

  private smallHeader(doc: PDFKit.PDFDocument, report: Report) {
    return drawSmallHeader(doc, report.hotel.name, `${report.title} · ${report.period}`, MARGIN);
  }

  private table(doc: PDFKit.PDFDocument, table: ReportTable, start: number, width: number, bottom: number, newPage: () => number) {
    let y = start;
    if (!table.rows.length) {
      doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8.5).text(table.empty ?? 'Sem dados', MARGIN, y, { width });
      return doc.y + 4;
    }
    const weights = table.columns.map((column) => column.weight ?? 1);
    const sum = weights.reduce((total, weight) => total + weight, 0);
    const widths = weights.map((weight) => (weight / sum) * width);
    const xs = widths.map((_, index) => MARGIN + widths.slice(0, index).reduce((total, value) => total + value, 0));
    const pad = 4;
    const fontSize = table.columns.length > 8 ? 7 : 8;

    const heightOf = (cells: string[], bold: boolean) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
      return Math.max(...cells.map((cell, index) => doc.heightOfString(cell ?? '', { width: widths[index] - pad * 2 }))) + 7;
    };
    const drawCells = (cells: string[], top: number, bold: boolean, color = INK) => {
      doc.fillColor(color).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
      cells.forEach((cell, index) => {
        doc.text(cell ?? '', xs[index] + pad, top + 3.5, { width: widths[index] - pad * 2, align: table.columns[index]?.align ?? 'left' });
      });
    };
    const headerRow = () => {
      const labels = table.columns.map((column) => column.label);
      const height = heightOf(labels, true);
      band(doc, MARGIN, y, width, height);
      drawCells(labels, y, true, '#ffffff');
      y += height;
    };
    const reserve = (height: number) => {
      if (y + height > bottom) {
        y = newPage();
        headerRow();
      }
    };

    headerRow();
    table.rows.forEach((row, index) => {
      const height = heightOf(row, false);
      reserve(height);
      if (index % 2 === 1) doc.rect(MARGIN, y, width, height).fill('#f8fafc');
      drawCells(row, y, false);
      doc.moveTo(MARGIN, y + height).lineTo(MARGIN + width, y + height).lineWidth(0.3).stroke('#e2e8f0');
      y += height;
    });
    if (table.totals) {
      const height = heightOf(table.totals, true);
      reserve(height);
      doc.rect(MARGIN, y, width, height).fill('#e0e7ff');
      drawCells(table.totals, y, true);
      y += height;
    }
    return y + 6;
  }
}

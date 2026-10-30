import { Hotel } from '@prisma/client';
import { UploadsService } from '../uploads/uploads';

export const A4 = { width: 595.28, height: 841.89, margin: 45 };

export const COLORS = {
  accent: '#4338ca',
  accent2: '#c026d3',
  ink: '#0f172a',
  text: '#334155',
  muted: '#64748b',
  soft: '#eef2ff',
  softer: '#f5f3ff',
  zebra: '#f8fafc',
  line: '#e2e8f0',
  good: '#047857',
  bad: '#b91c1c',
};

type Doc = PDFKit.PDFDocument;

export async function loadLogo(uploads: UploadsService, hotel: Pick<Hotel, 'logoFile'>) {
  if (!hotel.logoFile) return null;
  try {
    return await uploads.readForPdf(hotel.logoFile);
  } catch {
    return null;
  }
}

export function band(doc: Doc, x: number, y: number, width: number, height: number) {
  const gradient = doc.linearGradient(x, y, x + width, y);
  gradient.stop(0, COLORS.accent).stop(1, COLORS.accent2);
  doc.rect(x, y, width, height).fill(gradient);
}

export function hotelPlace(hotel: Hotel) {
  return [hotel.address, [hotel.postalCode, hotel.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

export interface HeaderOptions {
  hotel: Hotel;
  logo: Buffer | null;
  title: string;
  meta?: string[];
  alert?: string | null;
  margin?: number;
}

export function drawHeader(doc: Doc, { hotel, logo, title, meta = [], alert, margin = A4.margin }: HeaderOptions) {
  const width = doc.page.width - margin * 2;
  band(doc, 0, 0, doc.page.width, 8);
  const top = 30;

  let textX = margin;
  let logoBottom = top;
  if (logo) {
    try {
      doc.image(logo, margin, top, { fit: [105, 58] });
      textX = margin + 117;
      logoBottom = top + 58;
    } catch {
      textX = margin;
    }
  }

  const cardWidth = 205;
  const cardX = margin + width - cardWidth;
  const infoWidth = cardX - textX - 12;
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(14).text(hotel.name, textX, top, { width: infoWidth });
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.text);
  const contacts = [hotel.phone, hotel.email].filter((value): value is string => Boolean(value));
  const together = contacts.join(' · ');
  const details = [
    hotel.legalName && hotel.legalName !== hotel.name ? hotel.legalName : null,
    hotel.taxId ? `NIF: ${hotel.taxId}` : null,
    hotelPlace(hotel) || null,
    ...(doc.widthOfString(together) <= infoWidth ? [together || null] : contacts),
  ].filter((line): line is string => Boolean(line));
  for (const line of details) doc.text(line, textX, doc.y + 1, { width: infoWidth });
  const infoBottom = Math.max(doc.y, logoBottom);

  const pad = 10;
  const inner = cardWidth - pad * 2;
  doc.font('Helvetica-Bold').fontSize(12.5);
  let cardHeight = pad * 2 + doc.heightOfString(title.toUpperCase(), { width: inner });
  doc.font('Helvetica').fontSize(8);
  for (const line of meta) cardHeight += doc.heightOfString(line, { width: inner }) + 2;
  if (alert) {
    doc.font('Helvetica-Bold').fontSize(8.5);
    cardHeight += doc.heightOfString(alert, { width: inner }) + 4;
  }
  doc.roundedRect(cardX, top - 4, cardWidth, cardHeight, 8).fill(COLORS.soft);
  doc.rect(cardX, top + 4, 3, cardHeight - 16).fill(COLORS.accent);
  doc.fillColor(COLORS.accent).font('Helvetica-Bold').fontSize(12.5).text(title.toUpperCase(), cardX + pad, top - 4 + pad, { width: inner, align: 'right' });
  doc.fillColor(COLORS.ink).font('Helvetica').fontSize(8);
  for (const line of meta) doc.text(line, cardX + pad, doc.y + 2, { width: inner, align: 'right' });
  if (alert) doc.fillColor(COLORS.bad).font('Helvetica-Bold').fontSize(8.5).text(alert, cardX + pad, doc.y + 4, { width: inner, align: 'right' });

  const y = Math.max(infoBottom, top - 4 + cardHeight) + 14;
  band(doc, margin, y, width, 1.5);
  return y + 16;
}

export function drawSmallHeader(doc: Doc, hotelName: string, title: string, margin = A4.margin) {
  const width = doc.page.width - margin * 2;
  band(doc, 0, 0, doc.page.width, 5);
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9).text(hotelName, margin, 22, { width: width / 2, lineBreak: false });
  doc.fillColor(COLORS.accent).text(title, margin + width / 2, 22, { width: width / 2, align: 'right', lineBreak: false });
  band(doc, margin, 38, width, 0.8);
  return 50;
}

export function drawFooter(doc: Doc, left: string, right = '', margin = A4.margin) {
  const width = doc.page.width - margin * 2;
  const y = doc.page.height - 34;
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.moveTo(margin, y).lineTo(margin + width, y).lineWidth(0.5).stroke('#cbd5e1');
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7.5);
  doc.text(left, margin, y + 7, { width: right ? width - 90 : width, lineBreak: false, ellipsis: true, align: right ? 'left' : 'center' });
  if (right) doc.text(right, margin + width - 90, y + 7, { width: 90, align: 'right', lineBreak: false });
  band(doc, 0, doc.page.height - 6, doc.page.width, 6);
  doc.page.margins.bottom = bottom;
}

export function sectionTitle(doc: Doc, title: string, x: number, y: number, width: number) {
  doc.rect(x, y + 1, 3, 9).fill(COLORS.accent2);
  doc.fillColor(COLORS.accent).font('Helvetica-Bold').fontSize(9).text(title.toUpperCase(), x + 8, y, { width: width - 8, lineBreak: false });
  return y + 17;
}

export function infoCard(doc: Doc, x: number, y: number, width: number, title: string, rows: [string, string][], labelWidth = 80) {
  const pad = 10;
  const valueWidth = width - pad * 2 - labelWidth;
  doc.font('Helvetica').fontSize(8.5);
  const heights = rows.map(([, value]) => Math.max(doc.heightOfString(value || '-', { width: valueWidth }), 11) + 3);
  const height = pad * 2 + 16 + heights.reduce((sum, h) => sum + h, 0);
  doc.roundedRect(x, y, width, height, 8).fill(COLORS.softer);
  sectionTitle(doc, title, x + pad, y + pad, width - pad * 2);
  let rowY = y + pad + 17;
  rows.forEach(([label, value], index) => {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8.5).text(label, x + pad, rowY, { width: labelWidth - 4 });
    doc.fillColor(COLORS.ink).font('Helvetica').fontSize(8.5).text(value || '-', x + pad + labelWidth, rowY, { width: valueWidth });
    rowY += heights[index];
  });
  return y + height;
}

export interface Column {
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

export function tableHeader(doc: Doc, x: number, y: number, columns: Column[], fontSize = 8.5) {
  const width = columns.reduce((sum, column) => sum + column.width, 0);
  const height = fontSize + 10;
  const gradient = doc.linearGradient(x, y, x + width, y);
  gradient.stop(0, COLORS.accent).stop(1, '#6d28d9');
  doc.roundedRect(x, y, width, height, 4).fill(gradient);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(fontSize);
  let cx = x;
  for (const column of columns) {
    doc.text(column.label, cx + 5, y + 5, { width: column.width - 10, align: column.align ?? 'left', lineBreak: false });
    cx += column.width;
  }
  return y + height;
}

export function tableRow(doc: Doc, x: number, y: number, columns: Column[], cells: string[], index: number, options: { fontSize?: number; bold?: boolean; fill?: string } = {}) {
  const fontSize = options.fontSize ?? 8.5;
  const width = columns.reduce((sum, column) => sum + column.width, 0);
  doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
  const height = Math.max(...cells.map((cell, i) => doc.heightOfString(cell ?? '', { width: columns[i].width - 10 }))) + 9;
  const fill = options.fill ?? (index % 2 === 1 ? COLORS.zebra : null);
  if (fill) doc.rect(x, y, width, height).fill(fill);
  doc.fillColor(COLORS.ink).font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
  let cx = x;
  cells.forEach((cell, i) => {
    doc.text(cell ?? '', cx + 5, y + 4.5, { width: columns[i].width - 10, align: columns[i].align ?? 'left' });
    cx += columns[i].width;
  });
  doc.moveTo(x, y + height).lineTo(x + width, y + height).lineWidth(0.3).stroke(COLORS.line);
  return y + height;
}

export function rowHeight(doc: Doc, columns: Column[], cells: string[], fontSize = 8.5) {
  doc.font('Helvetica').fontSize(fontSize);
  return Math.max(...cells.map((cell, i) => doc.heightOfString(cell ?? '', { width: columns[i].width - 10 }))) + 9;
}

export function totalsBox(doc: Doc, x: number, y: number, width: number, lines: { label: string; value: string; strong?: boolean; color?: string }[]) {
  const pad = 10;
  const regular = lines.filter((line) => !line.strong);
  const strong = lines.filter((line) => line.strong);
  const height = pad * 2 + regular.length * 15 + strong.length * 26;
  doc.roundedRect(x, y, width, height, 8).fill(COLORS.softer);
  let ly = y + pad;
  for (const line of regular) {
    doc.fillColor(line.color ?? COLORS.text).font('Helvetica').fontSize(9).text(line.label, x + pad, ly, { width: width / 2 });
    doc.fillColor(line.color ?? COLORS.ink).text(line.value, x + width / 2, ly, { width: width / 2 - pad, align: 'right' });
    ly += 15;
  }
  for (const line of strong) {
    ly += 2;
    const gradient = doc.linearGradient(x, ly, x + width, ly);
    gradient.stop(0, COLORS.accent).stop(1, COLORS.accent2);
    doc.roundedRect(x + 4, ly, width - 8, 22, 6).fill(gradient);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text(line.label, x + pad + 2, ly + 6, { width: width / 2 });
    doc.text(line.value, x + width / 2, ly + 6, { width: width / 2 - pad - 2, align: 'right' });
    ly += 24;
  }
  return y + height;
}

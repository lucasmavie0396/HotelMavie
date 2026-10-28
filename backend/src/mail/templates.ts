import { Hotel } from '@prisma/client';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

export function formatDate(date: Date | string) {
  const iso = typeof date === 'string' ? date : date.toISOString();
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function formatMoney(value: { toString(): string } | number, currency: string) {
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency }).format(Number(value.toString()));
}

function layout(hotel: Hotel, title: string, body: string) {
  const contacts = [hotel.address, hotel.phone, hotel.email].filter(Boolean).map(escapeHtml).join(' · ');
  return `<!doctype html><html lang="pt"><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;padding:28px">
<tr><td style="font-size:20px;font-weight:bold;padding-bottom:4px">${escapeHtml(hotel.name)}</td></tr>
<tr><td style="font-size:16px;color:#4f46e5;padding-bottom:16px">${escapeHtml(title)}</td></tr>
<tr><td style="font-size:14px;line-height:1.6">${body}</td></tr>
<tr><td style="font-size:12px;color:#64748b;padding-top:24px;border-top:1px solid #e2e8f0">${contacts}</td></tr>
</table></td></tr></table></body></html>`;
}

export interface StaySummary {
  code: string;
  guestName: string;
  roomType: string;
  checkIn: Date | string;
  checkOut: Date | string;
  adults: number;
  children: number;
  totalAmount: { toString(): string };
}

function stayTable(stay: StaySummary, currency: string) {
  const rows: [string, string][] = [
    ['Codigo', `<strong>${escapeHtml(stay.code)}</strong>`],
    ['Quarto', escapeHtml(stay.roomType)],
    ['Entrada', formatDate(stay.checkIn)],
    ['Saida', formatDate(stay.checkOut)],
    ['Hospedes', `${stay.adults} adultos${stay.children ? `, ${stay.children} criancas` : ''}`],
    ['Total', formatMoney(stay.totalAmount, currency)],
  ];
  return `<table role="presentation" cellpadding="6" style="border-collapse:collapse;margin:12px 0">${rows
    .map(([label, value]) => `<tr><td style="color:#64748b">${label}</td><td>${value}</td></tr>`)
    .join('')}</table>`;
}

export function bookingRequestEmail(hotel: Hotel, stay: StaySummary) {
  return {
    subject: `Pedido de reserva ${stay.code} recebido - ${hotel.name}`,
    html: layout(
      hotel,
      'Recebemos o seu pedido de reserva',
      `<p>Ola ${escapeHtml(stay.guestName)},</p><p>Obrigado pelo seu pedido. A reserva fica pendente ate o hotel a confirmar; vai receber um novo email nessa altura.</p>${stayTable(stay, hotel.currency)}<p>Para qualquer alteracao responda a este email indicando o codigo da reserva.</p>`,
    ),
  };
}

export function newBookingAlertEmail(hotel: Hotel, stay: StaySummary, guestEmail: string) {
  return {
    subject: `Nova reserva online ${stay.code} por confirmar`,
    html: layout(
      hotel,
      'Nova reserva online por confirmar',
      `<p>Chegou um pedido de reserva pelo site.</p>${stayTable(stay, hotel.currency)}<p>Hospede: ${escapeHtml(stay.guestName)} &lt;${escapeHtml(guestEmail)}&gt;</p><p>Confirme ou recuse no painel, em Reservas.</p>`,
    ),
  };
}

export function bookingConfirmedEmail(hotel: Hotel, stay: StaySummary) {
  return {
    subject: `Reserva ${stay.code} confirmada - ${hotel.name}`,
    html: layout(
      hotel,
      'A sua reserva esta confirmada',
      `<p>Ola ${escapeHtml(stay.guestName)},</p><p>Temos o prazer de confirmar a sua reserva.</p>${stayTable(stay, hotel.currency)}<p>Ate breve!</p>`,
    ),
  };
}

export function invoiceEmail(hotel: Hotel, invoice: { fullNumber: string; customerName: string; grossTotal: { toString(): string }; currency: string }) {
  return {
    subject: `${invoice.fullNumber} - ${hotel.name}`,
    html: layout(
      hotel,
      `Documento ${invoice.fullNumber}`,
      `<p>Ola ${escapeHtml(invoice.customerName)},</p><p>Segue em anexo o documento <strong>${escapeHtml(invoice.fullNumber)}</strong>, no valor de ${formatMoney(invoice.grossTotal, invoice.currency)}.</p><p>Obrigado pela preferencia.</p>`,
    ),
  };
}

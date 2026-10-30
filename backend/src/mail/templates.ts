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

export type MailLang = 'pt' | 'en';

export function mailLang(value?: string | null): MailLang {
  return value === 'en' ? 'en' : 'pt';
}

export function formatMoney(value: { toString(): string } | number, currency: string, lang: MailLang = 'pt') {
  return new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'pt-PT', { style: 'currency', currency }).format(Number(value.toString()));
}

const GUEST_TEXT = {
  pt: {
    code: 'Codigo',
    room: 'Quarto',
    checkIn: 'Entrada',
    checkOut: 'Saida',
    guests: 'Hospedes',
    guestsValue: (adults: number, children: number) => `${adults} adultos${children ? `, ${children} criancas` : ''}`,
    total: 'Total',
    deposit: 'Sinal',
    reference: 'Referencia do pagamento',
    hello: (name: string) => `Ola ${name},`,
    requestSubject: (code: string, hotel: string) => `Pedido de reserva ${code} recebido - ${hotel}`,
    requestTitle: 'Recebemos o seu pedido de reserva',
    requestWithDeposit: 'Obrigado pelo seu pedido. A reserva fica pendente ate o hotel confirmar a rececao do sinal; vai receber o comprovativo por email nessa altura.',
    requestPlain: 'Obrigado pelo seu pedido. A reserva fica pendente ate o hotel a confirmar; vai receber um novo email nessa altura.',
    requestChanges: 'Para qualquer alteracao responda a este email indicando o codigo da reserva.',
    confirmedSubject: (code: string, hotel: string) => `Reserva ${code} confirmada - ${hotel}`,
    confirmedTitle: 'A sua reserva esta confirmada',
    confirmedText: 'Temos o prazer de confirmar a sua reserva.',
    seeYou: 'Ate breve!',
    depositSubject: (code: string, hotel: string) => `Reserva ${code} confirmada - sinal recebido - ${hotel}`,
    depositTitle: 'Sinal recebido: a sua reserva esta confirmada',
    depositText: 'Confirmamos a rececao do sinal e a sua reserva. Segue em anexo o comprovativo.',
    depositRemaining: (amount: string) => `O valor restante, <strong>${amount}</strong>, sera cobrado no check-in ou no check-out, juntamente com os consumos.`,
    invoiceTitle: (number: string) => `Documento ${number}`,
    invoiceText: (number: string, amount: string) => `Segue em anexo o documento <strong>${number}</strong>, no valor de ${amount}.`,
    thanks: 'Obrigado pela preferencia.',
  },
  en: {
    code: 'Code',
    room: 'Room',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    guests: 'Guests',
    guestsValue: (adults: number, children: number) => `${adults} adult(s)${children ? `, ${children} child(ren)` : ''}`,
    total: 'Total',
    deposit: 'Deposit',
    reference: 'Payment reference',
    hello: (name: string) => `Hello ${name},`,
    requestSubject: (code: string, hotel: string) => `Booking request ${code} received - ${hotel}`,
    requestTitle: 'We have received your booking request',
    requestWithDeposit: 'Thank you for your request. The booking stays pending until the hotel confirms receipt of the deposit; you will then receive the receipt by email.',
    requestPlain: 'Thank you for your request. The booking stays pending until the hotel confirms it; you will receive another email then.',
    requestChanges: 'For any change, reply to this email quoting your booking code.',
    confirmedSubject: (code: string, hotel: string) => `Booking ${code} confirmed - ${hotel}`,
    confirmedTitle: 'Your booking is confirmed',
    confirmedText: 'We are pleased to confirm your booking.',
    seeYou: 'See you soon!',
    depositSubject: (code: string, hotel: string) => `Booking ${code} confirmed - deposit received - ${hotel}`,
    depositTitle: 'Deposit received: your booking is confirmed',
    depositText: 'We confirm receipt of the deposit and your booking. Please find the receipt attached.',
    depositRemaining: (amount: string) => `The remaining balance of <strong>${amount}</strong> will be charged at check-in or check-out, together with any extras.`,
    invoiceTitle: (number: string) => `Document ${number}`,
    invoiceText: (number: string, amount: string) => `Please find attached document <strong>${number}</strong>, for ${amount}.`,
    thanks: 'Thank you for choosing us.',
  },
};

function layout(hotel: Hotel, title: string, body: string, lang: MailLang = 'pt') {
  const contacts = [hotel.address, hotel.phone, hotel.email].filter(Boolean).map(escapeHtml).join(' · ');
  return `<!doctype html><html lang="${lang}"><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
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
  depositAmount?: { toString(): string } | null;
  depositReference?: string | null;
}

function stayTable(stay: StaySummary, currency: string, lang: MailLang = 'pt') {
  const text = GUEST_TEXT[lang];
  const rows: [string, string][] = [
    [text.code, `<strong>${escapeHtml(stay.code)}</strong>`],
    [text.room, escapeHtml(stay.roomType)],
    [text.checkIn, formatDate(stay.checkIn)],
    [text.checkOut, formatDate(stay.checkOut)],
    [text.guests, text.guestsValue(stay.adults, stay.children)],
    [text.total, formatMoney(stay.totalAmount, currency, lang)],
  ];
  if (stay.depositAmount) {
    rows.push([text.deposit, formatMoney(stay.depositAmount, currency, lang)]);
    if (stay.depositReference) rows.push([text.reference, escapeHtml(stay.depositReference)]);
  }
  return `<table role="presentation" cellpadding="6" style="border-collapse:collapse;margin:12px 0">${rows
    .map(([label, value]) => `<tr><td style="color:#64748b">${label}</td><td>${value}</td></tr>`)
    .join('')}</table>`;
}

export function bookingRequestEmail(hotel: Hotel, stay: StaySummary, lang: MailLang = 'pt') {
  const text = GUEST_TEXT[lang];
  return {
    subject: text.requestSubject(stay.code, hotel.name),
    html: layout(
      hotel,
      text.requestTitle,
      `<p>${text.hello(escapeHtml(stay.guestName))}</p><p>${stay.depositAmount ? text.requestWithDeposit : text.requestPlain}</p>${stayTable(stay, hotel.currency, lang)}<p>${text.requestChanges}</p>`,
      lang,
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

export function bookingConfirmedEmail(hotel: Hotel, stay: StaySummary, lang: MailLang = 'pt') {
  const text = GUEST_TEXT[lang];
  return {
    subject: text.confirmedSubject(stay.code, hotel.name),
    html: layout(
      hotel,
      text.confirmedTitle,
      `<p>${text.hello(escapeHtml(stay.guestName))}</p><p>${text.confirmedText}</p>${stayTable(stay, hotel.currency, lang)}<p>${text.seeYou}</p>`,
      lang,
    ),
  };
}

export function depositConfirmedEmail(hotel: Hotel, stay: StaySummary, remaining: { toString(): string }, lang: MailLang = 'pt') {
  const text = GUEST_TEXT[lang];
  return {
    subject: text.depositSubject(stay.code, hotel.name),
    html: layout(
      hotel,
      text.depositTitle,
      `<p>${text.hello(escapeHtml(stay.guestName))}</p><p>${text.depositText}</p>${stayTable(stay, hotel.currency, lang)}<p>${text.depositRemaining(formatMoney(remaining, hotel.currency, lang))}</p><p>${text.seeYou}</p>`,
      lang,
    ),
  };
}

export function invoiceEmail(
  hotel: Hotel,
  invoice: { fullNumber: string; customerName: string; grossTotal: { toString(): string }; currency: string },
  lang: MailLang = 'pt',
) {
  const text = GUEST_TEXT[lang];
  return {
    subject: `${invoice.fullNumber} - ${hotel.name}`,
    html: layout(
      hotel,
      text.invoiceTitle(invoice.fullNumber),
      `<p>${text.hello(escapeHtml(invoice.customerName))}</p><p>${text.invoiceText(escapeHtml(invoice.fullNumber), formatMoney(invoice.grossTotal, invoice.currency, lang))}</p><p>${text.thanks}</p>`,
      lang,
    ),
  };
}

export function passwordResetEmail(name: string, link: string, minutes: number) {
  const system = { name: 'MAVIE-HGest', address: null, phone: null, email: null } as Hotel;
  return {
    subject: 'Repor a password do MAVIE-HGest',
    html: layout(
      system,
      'Pedido para repor a password',
      `<p>Ola ${escapeHtml(name)},</p><p>Recebemos um pedido para repor a sua password. O link e valido durante ${minutes} minutos e so pode ser usado uma vez:</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#4338ca;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none">Repor password</a></p><p style="font-size:12px;color:#64748b">Se nao pediu esta alteracao, ignore este email: a password atual continua valida.</p>`,
    ),
  };
}

export function purchaseOrderEmail(hotel: Hotel, order: { number: string; supplierName: string; total: { toString(): string } }) {
  return {
    subject: `Encomenda ${order.number} - ${hotel.name}`,
    html: layout(
      hotel,
      `Encomenda ${order.number}`,
      `<p>Ola ${escapeHtml(order.supplierName)},</p><p>Segue em anexo a nossa encomenda <strong>${escapeHtml(order.number)}</strong>, no valor estimado de ${formatMoney(order.total, hotel.currency)}.</p><p>Agradecemos a confirmacao da encomenda e da data de entrega respondendo a este email.</p><p>Com os melhores cumprimentos,<br>${escapeHtml(hotel.name)}</p>`,
    ),
  };
}

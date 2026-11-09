import { InvoiceType } from '@prisma/client';

export const DOC_TYPE: Record<InvoiceType, string> = {
  INVOICE: 'FT',
  INVOICE_RECEIPT: 'FR',
  CREDIT_NOTE: 'NC',
  RECEIPT: 'RG',
};

export const PAYMENT_MECHANISM: Record<string, string> = {
  CASH: 'NU',
  CARD: 'CC',
  TRANSFER: 'TB',
  MOBILE: 'OU',
  OTHER: 'OU',
};

export const FINAL_CONSUMER_TAX_ID = '999999990';

const PARTS_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.AT_TIMEZONE ?? 'Europe/Lisbon',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function localParts(date: Date) {
  const parts = Object.fromEntries(PARTS_FORMAT.formatToParts(date).map((part) => [part.type, part.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { year: Number(parts.year), date: day, dateTime: `${day}T${parts.hour}:${parts.minute}:${parts.second}` };
}

export function signatureMessage(input: { issuedAt: Date; invoiceNo: string; grossTotal: { toFixed(digits: number): string }; previousHash: string | null }) {
  const { date, dateTime } = localParts(input.issuedAt);
  return `${date};${dateTime};${input.invoiceNo};${input.grossTotal.toFixed(2)};${input.previousHash ?? ''}`;
}

export function printedHash(signature: string) {
  return `${signature.charAt(0)}${signature.charAt(10)}${signature.charAt(20)}${signature.charAt(30)}`;
}

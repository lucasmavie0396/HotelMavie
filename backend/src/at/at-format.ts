import { InvoiceType, TaxCategory } from '@prisma/client';

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

export function receiptQrContent(input: {
  issuerTaxId: string | null;
  customerTaxId: string | null;
  issuedAt: Date;
  receiptNo: string;
  atcud: string | null;
  amount: { toString(): string };
  certificateNumber: string;
  cancelled: boolean;
}) {
  return [
    `A:${input.issuerTaxId ?? FINAL_CONSUMER_TAX_ID}`,
    `B:${input.customerTaxId || FINAL_CONSUMER_TAX_ID}`,
    'C:PT',
    'D:RG',
    `E:${input.cancelled ? 'A' : 'N'}`,
    `F:${localParts(input.issuedAt).date.replace(/-/g, '')}`,
    `G:${input.receiptNo}`,
    `H:${input.atcud ?? '0'}`,
    'I1:PT',
    'N:0.00',
    `O:${Number(input.amount.toString()).toFixed(2)}`,
    `R:${input.certificateNumber}`,
  ].join('*');
}

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

interface QrLine {
  taxCategory: TaxCategory;
  netAmount: { toString(): string };
  taxAmount: { toString(): string };
}

export function qrCodeContent(input: {
  issuerTaxId: string | null;
  customerTaxId: string | null;
  customerCountry?: string;
  type: InvoiceType;
  issuedAt: Date;
  invoiceNo: string;
  atcud: string | null;
  lines: QrLine[];
  taxTotal: { toString(): string };
  grossTotal: { toString(): string };
  signature: string;
  certificateNumber: string;
}) {
  const money = (value: number) => value.toFixed(2);
  const totals: Record<TaxCategory, { base: number; tax: number }> = {
    ISE: { base: 0, tax: 0 },
    RED: { base: 0, tax: 0 },
    INT: { base: 0, tax: 0 },
    NOR: { base: 0, tax: 0 },
  };
  for (const line of input.lines) {
    totals[line.taxCategory].base += Number(line.netAmount.toString());
    totals[line.taxCategory].tax += Number(line.taxAmount.toString());
  }
  const fields: [string, string][] = [
    ['A', input.issuerTaxId ?? FINAL_CONSUMER_TAX_ID],
    ['B', input.customerTaxId || FINAL_CONSUMER_TAX_ID],
    ['C', input.customerCountry ?? 'PT'],
    ['D', DOC_TYPE[input.type]],
    ['E', 'N'],
    ['F', localParts(input.issuedAt).date.replace(/-/g, '')],
    ['G', input.invoiceNo],
    ['H', input.atcud ?? '0'],
    ['I1', 'PT'],
  ];
  if (totals.ISE.base) fields.push(['I2', money(totals.ISE.base)]);
  if (totals.RED.base) fields.push(['I3', money(totals.RED.base)], ['I4', money(totals.RED.tax)]);
  if (totals.INT.base) fields.push(['I5', money(totals.INT.base)], ['I6', money(totals.INT.tax)]);
  if (totals.NOR.base) fields.push(['I7', money(totals.NOR.base)], ['I8', money(totals.NOR.tax)]);
  fields.push(
    ['N', money(Number(input.taxTotal.toString()))],
    ['O', money(Number(input.grossTotal.toString()))],
    ['Q', printedHash(input.signature)],
    ['R', input.certificateNumber],
  );
  return fields.map(([key, value]) => `${key}:${value}`).join('*');
}

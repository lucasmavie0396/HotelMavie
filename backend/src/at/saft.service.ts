import { BadRequestException, Injectable } from '@nestjs/common';
import { Invoice, InvoiceLine, InvoiceType, TaxCategory } from '@prisma/client';
import { addDays, parseDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { AtSigningService } from './at-signing.service';
import { DOC_TYPE, FINAL_CONSUMER_TAX_ID, localParts } from './at-format';

const VERSION = '0.1.0';
const FINAL_CONSUMER_ID = 'CF';
const TAX_DESCRIPTIONS: Record<TaxCategory, string> = {
  RED: 'Taxa reduzida',
  INT: 'Taxa intermedia',
  NOR: 'Taxa normal',
  ISE: 'Isento',
};

function esc(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function el(name: string, value: unknown) {
  return `<${name}>${esc(value)}</${name}>`;
}

function amount(value: { toString(): string } | number, digits = 2) {
  return Number(value.toString()).toFixed(digits);
}

function truncate(value: string | null | undefined, max: number, fallback = 'Desconhecido') {
  const text = (value ?? '').trim() || fallback;
  return text.length > max ? text.slice(0, max) : text;
}

type FullInvoice = Invoice & { lines: InvoiceLine[]; creditOf: { fullNumber: string } | null };

@Injectable()
export class SaftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signing: AtSigningService,
  ) {}

  async export(hotelId: number, fromValue: string, toValue: string) {
    const from = parseDate(fromValue);
    const to = addDays(parseDate(toValue), 1);
    if (to <= from) {
      throw new BadRequestException('Periodo invalido');
    }
    if (localParts(from).year !== localParts(addDays(to, -1)).year) {
      throw new BadRequestException('O SAF-T de faturacao e por ano fiscal: escolhe datas do mesmo ano');
    }
    const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: hotelId } });
    if (!hotel.taxId) {
      throw new BadRequestException('Preenche o NIF do hotel em Configuracao antes de exportar o SAF-T');
    }
    const invoices: FullInvoice[] = await this.prisma.invoice.findMany({
      where: { hotelId, issuedAt: { gte: from, lt: to } },
      include: { lines: { orderBy: { id: 'asc' } }, creditOf: { select: { fullNumber: true } } },
      orderBy: [{ type: 'asc' }, { issuedAt: 'asc' }, { number: 'asc' }],
    });

    const customers = new Map<string, FullInvoice>();
    const products = new Map<string, string>();
    const taxes = new Map<string, { category: TaxCategory; rate: string }>();
    for (const invoice of invoices) {
      customers.set(this.customerId(invoice), invoice);
      for (const line of invoice.lines) {
        if (!products.has(line.productCode)) products.set(line.productCode, line.description);
        taxes.set(`${line.taxCategory}:${amount(line.taxRate)}`, { category: line.taxCategory, rate: amount(line.taxRate) });
      }
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const invoice of invoices) {
      if (invoice.type === InvoiceType.CREDIT_NOTE) totalDebit += Number(invoice.netTotal);
      else totalCredit += Number(invoice.netTotal);
    }

    const now = localParts(new Date());
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:PT_1.04_01">',
      '<Header>',
      el('AuditFileVersion', '1.04_01'),
      el('CompanyID', hotel.taxId),
      el('TaxRegistrationNumber', hotel.taxId),
      el('TaxAccountingBasis', 'F'),
      el('CompanyName', truncate(hotel.legalName ?? hotel.name, 100)),
      el('BusinessName', truncate(hotel.name, 60)),
      '<CompanyAddress>',
      el('AddressDetail', truncate(hotel.address, 100)),
      el('City', truncate(hotel.city, 50)),
      el('PostalCode', truncate(hotel.postalCode, 20)),
      el('Country', hotel.country),
      '</CompanyAddress>',
      el('FiscalYear', localParts(from).year),
      el('StartDate', fromValue),
      el('EndDate', toValue),
      el('CurrencyCode', 'EUR'),
      el('DateCreated', now.date),
      el('TaxEntity', 'Global'),
      el('ProductCompanyTaxID', process.env.AT_PRODUCER_TAX_ID || hotel.taxId),
      el('SoftwareCertificateNumber', this.signing.certificateNumber),
      el('ProductID', 'MAVIE-HGest/MAVIE'),
      el('ProductVersion', VERSION),
      '</Header>',
      '<MasterFiles>',
      ...[...customers.entries()].map(([id, invoice]) => this.customerXml(id, invoice)),
      ...[...products.entries()].map(([code, description]) =>
        [
          '<Product>',
          el('ProductType', code === 'ALOJ' || code === 'EXTRA' ? 'S' : 'P'),
          el('ProductCode', code),
          el('ProductDescription', truncate(description, 200)),
          el('ProductNumberCode', code),
          '</Product>',
        ].join(''),
      ),
      '<TaxTable>',
      ...[...taxes.values()].map((tax) =>
        [
          '<TaxTableEntry>',
          el('TaxType', 'IVA'),
          el('TaxCountryRegion', 'PT'),
          el('TaxCode', tax.category),
          el('Description', TAX_DESCRIPTIONS[tax.category]),
          el('TaxPercentage', tax.rate),
          '</TaxTableEntry>',
        ].join(''),
      ),
      '</TaxTable>',
      '</MasterFiles>',
      '<SourceDocuments>',
      '<SalesInvoices>',
      el('NumberOfEntries', invoices.length),
      el('TotalDebit', amount(totalDebit)),
      el('TotalCredit', amount(totalCredit)),
      ...invoices.map((invoice) => this.invoiceXml(invoice)),
      '</SalesInvoices>',
      '</SourceDocuments>',
      '</AuditFile>',
    ].join('\n');

    return { filename: `SAFT-PT_${hotel.taxId}_${fromValue}_${toValue}.xml`, xml, count: invoices.length };
  }

  private customerId(invoice: Invoice) {
    return invoice.customerTaxId && invoice.customerTaxId !== FINAL_CONSUMER_TAX_ID ? invoice.customerTaxId : FINAL_CONSUMER_ID;
  }

  private customerXml(id: string, invoice: Invoice) {
    const finalConsumer = id === FINAL_CONSUMER_ID;
    return [
      '<Customer>',
      el('CustomerID', id),
      el('AccountID', 'Desconhecido'),
      el('CustomerTaxID', finalConsumer ? FINAL_CONSUMER_TAX_ID : id),
      el('CompanyName', finalConsumer ? 'Consumidor final' : truncate(invoice.customerName, 100)),
      '<BillingAddress>',
      el('AddressDetail', finalConsumer ? 'Desconhecido' : truncate(invoice.customerAddress, 100)),
      el('City', 'Desconhecido'),
      el('PostalCode', 'Desconhecido'),
      el('Country', finalConsumer ? 'Desconhecido' : 'PT'),
      '</BillingAddress>',
      el('SelfBillingIndicator', 0),
      '</Customer>',
    ].join('');
  }

  private invoiceXml(invoice: FullInvoice) {
    const issued = localParts(invoice.issuedAt);
    const credit = invoice.type === InvoiceType.CREDIT_NOTE;
    const lines = invoice.lines.map((line, index) => {
      const quantity = Number(line.quantity);
      const unitNet = quantity ? Number(line.netAmount) / quantity : 0;
      return [
        '<Line>',
        el('LineNumber', index + 1),
        el('ProductCode', line.productCode),
        el('ProductDescription', truncate(line.description, 200)),
        el('Quantity', amount(line.quantity, 3)),
        el('UnitOfMeasure', 'UN'),
        el('UnitPrice', unitNet.toFixed(6)),
        el('TaxPointDate', issued.date),
        credit && invoice.creditOf
          ? `<References>${el('Reference', invoice.creditOf.fullNumber)}${el('Reason', truncate(invoice.reason, 50))}</References>`
          : '',
        el('Description', truncate(line.description, 200)),
        el(credit ? 'DebitAmount' : 'CreditAmount', amount(line.netAmount)),
        '<Tax>',
        el('TaxType', 'IVA'),
        el('TaxCountryRegion', 'PT'),
        el('TaxCode', line.taxCategory),
        el('TaxPercentage', amount(line.taxRate)),
        '</Tax>',
        line.taxCategory === TaxCategory.ISE
          ? `${el('TaxExemptionReason', truncate(line.exemptionReason, 60))}${el('TaxExemptionCode', line.exemptionCode ?? '')}`
          : '',
        el('SettlementAmount', '0.00'),
        '</Line>',
      ].join('');
    });
    return [
      '<Invoice>',
      el('InvoiceNo', invoice.fullNumber),
      el('ATCUD', invoice.atcud ?? '0'),
      '<DocumentStatus>',
      el('InvoiceStatus', 'N'),
      el('InvoiceStatusDate', issued.dateTime),
      el('SourceID', invoice.createdById ?? 'SISTEMA'),
      el('SourceBilling', 'P'),
      '</DocumentStatus>',
      el('Hash', invoice.hash),
      el('HashControl', invoice.keyVersion),
      el('Period', Number(issued.date.slice(5, 7))),
      el('InvoiceDate', issued.date),
      el('InvoiceType', DOC_TYPE[invoice.type]),
      '<SpecialRegimes>',
      el('SelfBillingIndicator', 0),
      el('CashVATSchemeIndicator', 0),
      el('ThirdPartiesBillingIndicator', 0),
      '</SpecialRegimes>',
      el('SourceID', invoice.createdById ?? 'SISTEMA'),
      el('SystemEntryDate', issued.dateTime),
      el('CustomerID', this.customerId(invoice)),
      ...lines,
      '<DocumentTotals>',
      el('TaxPayable', amount(invoice.taxTotal)),
      el('NetTotal', amount(invoice.netTotal)),
      el('GrossTotal', amount(invoice.grossTotal)),
      '</DocumentTotals>',
      '</Invoice>',
    ].join('');
  }
}

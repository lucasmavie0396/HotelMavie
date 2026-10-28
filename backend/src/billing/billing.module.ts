import { Module } from '@nestjs/common';
import { TaxRatesController } from '../tax-rates/tax-rates.controller';
import { BillingController } from './billing.controller';
import { CashService } from './cash.service';
import { FolioService } from './folio.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicesService } from './invoices.service';

@Module({
  controllers: [BillingController, TaxRatesController],
  providers: [FolioService, InvoicesService, InvoicePdfService, CashService],
  exports: [FolioService, InvoicesService],
})
export class BillingModule {}

import { Module } from '@nestjs/common';
import { AtController } from '../at/at.controller';
import { AtSigningService } from '../at/at-signing.service';
import { SaftService } from '../at/saft.service';
import { TaxRatesController } from '../tax-rates/tax-rates.controller';
import { BillingController } from './billing.controller';
import { CashService } from './cash.service';
import { FolioService } from './folio.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicesService } from './invoices.service';

@Module({
  controllers: [BillingController, TaxRatesController, AtController],
  providers: [FolioService, InvoicesService, InvoicePdfService, CashService, AtSigningService, SaftService],
  exports: [FolioService, InvoicesService, AtSigningService],
})
export class BillingModule {}

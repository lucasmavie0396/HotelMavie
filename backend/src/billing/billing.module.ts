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
import { ReceiptsService } from './receipts.service';
import { TicketPdfService } from './ticket-pdf.service';

@Module({
  controllers: [BillingController, TaxRatesController, AtController],
  providers: [FolioService, InvoicesService, InvoicePdfService, CashService, AtSigningService, SaftService, ReceiptsService, TicketPdfService],
  exports: [FolioService, InvoicesService, AtSigningService, TicketPdfService],
})
export class BillingModule {}

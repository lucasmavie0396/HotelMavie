import { Module } from '@nestjs/common';
import { BillingModule } from './billing/billing.module';
import { CatalogController } from './catalog/catalog.controller';
import { RecipesService } from './catalog/recipes.service';
import { PosController } from './pos/pos.controller';
import { PosService } from './pos/pos.service';
import { PrintingController, PrintService } from './printing/printing';
import { ReportsModule } from './reports/reports.module';
import { PurchasesController } from './purchases/purchases.controller';
import { PurchasesService } from './purchases/purchases.service';
import { StockController } from './stock/stock.controller';
import { StockService } from './stock/stock.service';

@Module({
  imports: [BillingModule, ReportsModule],
  controllers: [CatalogController, StockController, PurchasesController, PosController, PrintingController],
  providers: [StockService, PurchasesService, PosService, RecipesService, PrintService],
})
export class OperationsModule {}

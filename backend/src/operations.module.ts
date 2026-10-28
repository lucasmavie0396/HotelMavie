import { Module } from '@nestjs/common';
import { BillingModule } from './billing/billing.module';
import { CatalogController } from './catalog/catalog.controller';
import { RecipesService } from './catalog/recipes.service';
import { PosController } from './pos/pos.controller';
import { PosService } from './pos/pos.service';
import { PurchasesController } from './purchases/purchases.controller';
import { PurchasesService } from './purchases/purchases.service';
import { StockController } from './stock/stock.controller';
import { StockService } from './stock/stock.service';

@Module({
  imports: [BillingModule],
  controllers: [CatalogController, StockController, PurchasesController, PosController],
  providers: [StockService, PurchasesService, PosService, RecipesService],
})
export class OperationsModule {}

import { Module } from '@nestjs/common';
import { AppAndroidController } from './app-android/app-android.controller';
import { EventCardsController } from './event-cards/event-cards.controller';
import { ExpensesController, ExpensesService } from './expenses/expenses';
import { EventCardsService } from './event-cards/event-cards.service';
import { BillingModule } from './billing/billing.module';
import { CatalogController } from './catalog/catalog.controller';
import { ProductOptionsController, ProductOptionsService } from './catalog/product-options';
import { ProductsExcelController } from './catalog/products-excel.controller';
import { ProductsExcelService } from './catalog/products-excel.service';
import { ImageSearchService } from './catalog/image-search';
import { RecipesService } from './catalog/recipes.service';
import { KdsController, PosController } from './pos/pos.controller';
import { PosService } from './pos/pos.service';
import { TablesController } from './pos/tables';
import { PrintingController, PrintService } from './printing/printing';
import { ReportsModule } from './reports/reports.module';
import { ReservationRoomServiceController, RoomDeviceController, RoomDevicesController, RoomOrdersController } from './room-service/room-service.controller';
import { RoomServiceService } from './room-service/room-service.service';
import { PurchasesController } from './purchases/purchases.controller';
import { PurchasesService } from './purchases/purchases.service';
import { StockDocumentsService } from './stock/stock-documents.service';
import { StockController } from './stock/stock.controller';
import { StockService } from './stock/stock.service';

@Module({
  imports: [BillingModule, ReportsModule],
  controllers: [ProductsExcelController, ProductOptionsController, CatalogController, StockController, PurchasesController, PosController, KdsController, TablesController, PrintingController, RoomDeviceController, RoomDevicesController, RoomOrdersController, ReservationRoomServiceController, AppAndroidController, EventCardsController, ExpensesController],
  providers: [ImageSearchService, StockService, StockDocumentsService, PurchasesService, PosService, RecipesService, PrintService, RoomServiceService, ProductsExcelService, EventCardsService, ExpensesService, ProductOptionsService],
})
export class OperationsModule {}

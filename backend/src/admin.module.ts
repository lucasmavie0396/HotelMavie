import { Module } from '@nestjs/common';
import { BackupsController } from './backups/backups.controller';
import { BackupsService } from './backups/backups.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsModule } from './reports/reports.module';
import { ProductionController } from './system/production.controller';
import { ProductionService } from './system/production.service';

@Module({
  imports: [ReportsModule],
  controllers: [ReportsController, BackupsController, ProductionController],
  providers: [BackupsService, ProductionService],
})
export class AdminModule {}

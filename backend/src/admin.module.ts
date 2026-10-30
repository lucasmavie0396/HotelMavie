import { Module } from '@nestjs/common';
import { BackupsController } from './backups/backups.controller';
import { BackupsService } from './backups/backups.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [ReportsModule],
  controllers: [ReportsController, BackupsController],
  providers: [BackupsService],
})
export class AdminModule {}

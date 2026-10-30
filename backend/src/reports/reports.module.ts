import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ReportBuilderService } from './report-builder.service';
import { ReportRenderService } from './report-render.service';

@Module({
  imports: [BillingModule],
  providers: [ReportBuilderService, ReportRenderService],
  exports: [ReportBuilderService, ReportRenderService],
})
export class ReportsModule {}

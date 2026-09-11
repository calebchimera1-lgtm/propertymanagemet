import { Module } from '@nestjs/common';
import { CsvExporter } from './exporters/csv.exporter';
import { PdfExporter } from './exporters/pdf.exporter';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import {
  ExpenseReport,
  IncomeReport,
  OutstandingRentReport,
  ProfitLossReport,
  RentCollectionReport,
} from './strategies/financial.strategies';
import {
  LeaseExpiryReport,
  MaintenanceReport,
  OccupancyReport,
  TenantReport,
} from './strategies/portfolio.strategies';

/**
 * One provider per report. Registering them explicitly rather than scanning a
 * directory keeps "which reports exist" answerable by reading one file.
 */
@Module({
  controllers: [ReportsController],
  providers: [
    ReportsService,
    CsvExporter,
    PdfExporter,
    RentCollectionReport,
    OutstandingRentReport,
    TenantReport,
    OccupancyReport,
    ExpenseReport,
    IncomeReport,
    ProfitLossReport,
    MaintenanceReport,
    LeaseExpiryReport,
  ],
  exports: [ReportsService],
})
export class ReportsModule {}

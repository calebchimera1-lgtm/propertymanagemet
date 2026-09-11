import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermissions } from '@/common/decorators';
import { CsvExporter } from './exporters/csv.exporter';
import { PdfExporter } from './exporters/pdf.exporter';
import { ExportReportQueryDto, ReportFiltersDto } from './dto/report.dto';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiCookieAuth()
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly csv: CsvExporter,
    private readonly pdf: PdfExporter,
  ) {}

  @Get()
  @RequirePermissions('reports.view')
  @ApiOperation({
    summary: 'What reports exist',
    description: 'Each entry names the filters that report actually honours, so the UI shows only those.',
  })
  @ApiOkResponse({ description: 'The report catalogue.' })
  catalogue() {
    return this.reports.catalogue();
  }

  @Get(':report')
  @RequirePermissions('reports.view')
  @ApiOperation({
    summary: 'Run a report',
    description:
      'Reads the live database. Organization- and scope-filtered like every other endpoint — a report is not a back door.',
  })
  @ApiNotFoundResponse({ description: 'No such report.' })
  run(@Param('report') report: string, @Query() filters: ReportFiltersDto) {
    return this.reports.run(report, filters);
  }

  @Get(':report/export')
  @RequirePermissions('reports.export')
  @ApiOperation({
    summary: 'Download a report as CSV or PDF',
    description:
      'Rendered from the same rows the screen shows, so paper and screen cannot disagree. Both formats state the filter set they cover.',
  })
  async export(
    @Param('report') report: string,
    @Query() query: ExportReportQueryDto,
    @Res({ passthrough: false }) response: Response,
  ): Promise<void> {
    const { format = 'csv', ...filters } = query;

    // Runs the same guards as the screen: an export is just another read.
    const meta = await this.reports.exportMeta(report, filters);
    const result = await this.reports.runForExport(report, filters);

    const stamp = meta.generatedAt.toISOString().slice(0, 10);
    const filename = `${report}-${stamp}.${format}`;

    // Attachment and nosniff, same as documents: a download must never be
    // rendered in the app origin.
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    if (format === 'pdf') {
      response.setHeader('Content-Type', 'application/pdf');
      this.pdf.render(result, meta).pipe(response);
      return;
    }

    // The BOM makes Excel open UTF-8 correctly; without it, a tenant called
    // "Wanjiku Njeri" can come out mangled on a Windows machine.
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.write('﻿');
    this.csv.stream(result, meta).pipe(response);
  }
}

import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators';
import { DashboardService } from './dashboard.service';
import { DashboardChartsQueryDto, DashboardSummaryQueryDto } from './dto/dashboard.dto';

@ApiTags('Dashboard')
@ApiCookieAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermissions('reports.view')
  @ApiOperation({
    summary: 'The numbers at the top of the dashboard',
    description:
      'Every figure is a SQL aggregate over the live database, scoped to the caller. A staff member with no property assignments gets zeros and scoped=true, never the whole organization.',
  })
  @ApiOkResponse({ description: 'Portfolio counts and the period’s money.' })
  summary(@Query() query: DashboardSummaryQueryDto) {
    return this.dashboard.summary(query);
  }

  @Get('charts')
  @RequirePermissions('reports.view')
  @ApiOperation({
    summary: 'Monthly series for the charts',
    description:
      'One row per month including empty ones, so a chart never draws a line straight through a month with no data.',
  })
  charts(@Query() query: DashboardChartsQueryDto) {
    return this.dashboard.charts(query);
  }

  @Get('worklists')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Overdue rent, expiring leases, open maintenance, recent payments' })
  worklists() {
    return this.dashboard.worklists();
  }
}

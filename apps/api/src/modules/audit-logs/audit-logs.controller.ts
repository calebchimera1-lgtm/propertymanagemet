import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators';
import { AuditLogsService } from './audit-logs.service';
import { ListAuditLogsQueryDto } from './dto/audit-log.dto';

/**
 * GET only. The audit trail has no write, edit or delete surface over HTTP by
 * design — rows appear because something happened, and nothing can make them
 * disappear through the API.
 */
@ApiTags('Audit logs')
@ApiCookieAuth()
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  @Get()
  @RequirePermissions('auditlogs.view')
  @ApiOperation({
    summary: 'Read the audit trail',
    description:
      'Newest first, filterable by actor, action, record and date. IP address and user agent are stored but not returned.',
  })
  @ApiOkResponse({ description: 'Paginated audit entries.' })
  list(@Query() query: ListAuditLogsQueryDto) {
    return this.auditLogs.list(query);
  }

  @Get('actions')
  @RequirePermissions('auditlogs.view')
  @ApiOperation({ summary: 'The action names present in this organization’s trail' })
  actions() {
    return this.auditLogs.actions();
  }
}

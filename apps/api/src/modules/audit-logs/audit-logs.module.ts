import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';

/**
 * Global for the writer (every module records to it); the reader is an ordinary
 * permission-gated controller.
 */
@Global()
@Module({
  controllers: [AuditLogsController],
  providers: [AuditLogService, AuditLogsService],
  exports: [AuditLogService],
})
export class AuditLogsModule {}

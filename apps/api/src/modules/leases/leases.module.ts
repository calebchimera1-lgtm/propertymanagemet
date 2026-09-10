import { Module } from '@nestjs/common';
import { LeaseStatusService } from './lease-status.service';
import { LeasesController } from './leases.controller';
import { LeasesService } from './leases.service';

@Module({
  controllers: [LeasesController],
  providers: [LeasesService, LeaseStatusService],
  exports: [LeasesService, LeaseStatusService],
})
export class LeasesModule {}

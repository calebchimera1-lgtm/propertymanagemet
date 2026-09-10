import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth/auth.module';
import { LeasesModule } from '@/modules/leases/leases.module';
import { LeaseStatusJob } from './lease-status.job';
import { RentGenerationJob } from './rent-generation.job';
import { SessionCleanupJob } from './session-cleanup.job';

@Module({
  imports: [AuthModule, LeasesModule],
  providers: [SessionCleanupJob, LeaseStatusJob, RentGenerationJob],
})
export class JobsModule {}

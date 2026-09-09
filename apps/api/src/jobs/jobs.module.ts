import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth/auth.module';
import { SessionCleanupJob } from './session-cleanup.job';

@Module({
  imports: [AuthModule],
  providers: [SessionCleanupJob],
})
export class JobsModule {}

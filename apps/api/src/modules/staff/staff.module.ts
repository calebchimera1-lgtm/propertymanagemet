import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth/auth.module';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

/**
 * Imports AuthModule for PasswordService and TokenService: an invite is a
 * password-reset token by another name, and there should be exactly one
 * implementation of "generate a single-use link".
 */
@Module({
  imports: [AuthModule],
  controllers: [StaffController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}

import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CookieService } from './cookie.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, PasswordService, TokenService, CookieService],
  // SessionService is exported because the global auth and CSRF guards depend
  // on it; the rest stays internal to the module.
  exports: [SessionService, PasswordService, TokenService],
})
export class AuthModule {}

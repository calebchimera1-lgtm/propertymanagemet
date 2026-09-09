import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthenticatedOnly, CurrentUser, Public, SkipCsrf } from '@/common/decorators';
import { LOGIN_THROTTLE, REGISTER_THROTTLE, SENSITIVE_THROTTLE } from '@/common/rate-limits';
import type { AuthContext } from '@/tenancy/tenant-context';
import { AuthService } from './auth.service';
import { CookieService } from './cookie.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
  VerifyEmailDto,
} from './dto/auth.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: CookieService,
  ) {}

  @Post('register')
  @Public()
  @SkipCsrf()
  @Throttle(REGISTER_THROTTLE)
  @ApiOperation({ summary: 'Create an organization and its first owner account' })
  @ApiCreatedResponse({ description: 'Organization created and the caller is signed in.' })
  @ApiBody({ type: RegisterDto })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { session, me } = await this.auth.register(dto, request);
    this.cookies.setSessionCookies(response, session.token, session.csrfToken, session.expiresAt);
    return me;
  }

  @Post('login')
  @Public()
  @SkipCsrf()
  @HttpCode(HttpStatus.OK)
  @Throttle(LOGIN_THROTTLE)
  @ApiOperation({ summary: 'Sign in and receive a session cookie' })
  @ApiOkResponse({ description: 'Signed in.' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { session, me } = await this.auth.login(dto, request);
    this.cookies.setSessionCookies(response, session.token, session.csrfToken, session.expiresAt);
    return me;
  }

  @Post('logout')
  @AuthenticatedOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @CurrentUser() auth: AuthContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(auth);
    this.cookies.clearSessionCookies(response);
  }

  @Post('logout-all')
  @AuthenticatedOnly()
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Revoke every session belonging to the current user' })
  async logoutAll(
    @CurrentUser() auth: AuthContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.logoutEverywhere(auth);
    this.cookies.clearSessionCookies(response);
    return result;
  }

  @Get('me')
  @AuthenticatedOnly()
  @ApiCookieAuth()
  @ApiOperation({ summary: 'The signed-in user, their organization, roles and permissions' })
  @ApiOkResponse({ description: 'Current identity and effective access.' })
  me(@CurrentUser() auth: AuthContext) {
    return this.auth.buildMe(auth.userId);
  }

  @Patch('profile')
  @AuthenticatedOnly()
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Update your own name and phone number' })
  updateProfile(@CurrentUser() auth: AuthContext, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(auth, dto);
  }

  @Post('forgot-password')
  @Public()
  @SkipCsrf()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(SENSITIVE_THROTTLE)
  @ApiOperation({ summary: 'Request a password reset link' })
  @ApiOkResponse({
    description:
      'Always 202, whether or not the address is registered — confirming it would leak account existence.',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto);
    return { message: 'If that email address has an account, a reset link is on its way.' };
  }

  @Post('reset-password')
  @Public()
  @SkipCsrf()
  @HttpCode(HttpStatus.OK)
  @Throttle(LOGIN_THROTTLE)
  @ApiOperation({ summary: 'Set a new password using a reset token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto);
    return { message: 'Your password has been changed. Please sign in.' };
  }

  @Post('change-password')
  @AuthenticatedOnly()
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Change your password (signs out all other sessions)' })
  async changePassword(@CurrentUser() auth: AuthContext, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(auth, dto);
    return { message: 'Password updated. Other devices have been signed out.' };
  }

  @Post('verify-email')
  @Public()
  @SkipCsrf()
  @HttpCode(HttpStatus.OK)
  @Throttle(SENSITIVE_THROTTLE)
  @ApiOperation({ summary: 'Confirm an email address with a verification token' })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.auth.verifyEmail(dto);
    return { message: 'Email address confirmed.' };
  }

  @Post('resend-verification')
  @AuthenticatedOnly()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(SENSITIVE_THROTTLE)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Send the verification email again' })
  async resendVerification(@CurrentUser() auth: AuthContext) {
    await this.auth.resendVerification(auth);
    return { message: 'If your address is unconfirmed, a new link has been sent.' };
  }

  @Get('sessions')
  @AuthenticatedOnly()
  @ApiCookieAuth()
  @ApiOperation({ summary: 'List your active sessions' })
  sessions(@CurrentUser() auth: AuthContext) {
    return this.auth.listSessions(auth);
  }

  @Delete('sessions/:id')
  @AuthenticatedOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Revoke one of your sessions' })
  revokeSession(@CurrentUser() auth: AuthContext, @Param('id') id: string): Promise<void> {
    return this.auth.revokeSession(auth, id);
  }
}

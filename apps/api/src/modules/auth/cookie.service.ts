import { Injectable } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { AppConfig } from '@/config/app.config';

/**
 * One place that decides how auth cookies are written, so a flag can never be
 * set correctly on login and forgotten on logout.
 */
@Injectable()
export class CookieService {
  constructor(private readonly config: AppConfig) {}

  private baseOptions(): CookieOptions {
    return {
      // Same-site because web and API share a registrable domain in every
      // environment (localhost:3000 → localhost:3001; app.x.com → api.x.com).
      sameSite: 'lax',
      secure: this.config.cookieSecure,
      domain: this.config.cookieDomain,
      path: '/',
    };
  }

  setSessionCookies(response: Response, token: string, csrfToken: string, expiresAt: Date): void {
    response.cookie(this.config.cookieName, token, {
      ...this.baseOptions(),
      httpOnly: true, // never readable by JavaScript
      expires: expiresAt,
    });

    // Readable by the client on purpose: it is echoed back in the X-CSRF-Token
    // header. It is an HMAC bound to the session, so possessing it without the
    // session cookie is useless.
    response.cookie(this.config.csrfCookieName, csrfToken, {
      ...this.baseOptions(),
      httpOnly: false,
      expires: expiresAt,
    });
  }

  clearSessionCookies(response: Response): void {
    const options = { ...this.baseOptions(), maxAge: 0 };
    response.cookie(this.config.cookieName, '', { ...options, httpOnly: true });
    response.cookie(this.config.csrfCookieName, '', { ...options, httpOnly: false });
  }
}

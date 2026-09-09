import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { TenantContextService } from './tenant-context.service';

/**
 * Opens the AsyncLocalStorage scope for the request.
 *
 * This runs before guards so the store already exists when the auth guard fills
 * in who the caller is. Wrapping next() in run() — rather than calling
 * enterWith() later — is what makes the context reliable across every await
 * downstream.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly tenant: TenantContextService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const requestId = request.get('x-request-id') ?? nanoid(21);
    const forwarded = request.get('x-forwarded-for');

    response.setHeader('X-Request-Id', requestId);

    this.tenant.run(
      {
        requestId,
        ipAddress: (forwarded ? forwarded.split(',')[0]?.trim() : request.ip)?.slice(0, 64),
        userAgent: request.get('user-agent')?.slice(0, 500),
      },
      () => next(),
    );
  }
}

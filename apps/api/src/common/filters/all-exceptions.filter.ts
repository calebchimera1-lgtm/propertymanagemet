import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@pm/database';
import { type ApiErrorDetail, type ApiErrorResponse, ERROR_CODES } from '@pm/types';
import type { Request, Response } from 'express';
import { DomainError } from '@/common/errors/domain.errors';
import { AppConfig } from '@/config/app.config';
import { TenantContextService } from '@/tenancy/tenant-context.service';

interface Normalised {
  status: number;
  code: string;
  message: string;
  details?: ApiErrorDetail[];
  /** Logged, never sent. */
  internal?: unknown;
}

/**
 * Every error leaves the API in the same envelope (blueprint §12), and nothing
 * about the internals leaves with it: no stack traces, no Prisma messages, no
 * driver text. The requestId ties the sanitised response to the full server log.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  constructor(
    private readonly config: AppConfig,
    private readonly tenant: TenantContextService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const normalised = this.normalise(exception);
    const requestId = this.tenant.requestId;

    const body: ApiErrorResponse = {
      statusCode: normalised.status,
      error: HttpStatus[normalised.status] ?? 'Error',
      code: normalised.code,
      message: normalised.message,
      ...(normalised.details ? { details: normalised.details } : {}),
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
      requestId,
    };

    if (normalised.status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} → ${normalised.status} [${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (!this.config.isTest) {
      this.logger.warn(
        `${request.method} ${request.originalUrl} → ${normalised.status} ${normalised.code} [${requestId}]`,
      );
    }

    response.status(normalised.status).json(body);
  }

  private normalise(exception: unknown): Normalised {
    if (exception instanceof DomainError) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Something went wrong on our side. Please try again.',
      internal: exception,
    };
  }

  private fromHttpException(exception: HttpException): Normalised {
    const status = exception.getStatus();
    const payload = exception.getResponse();

    // ValidationPipe returns { message: string[] } — turn it into field details.
    if (typeof payload === 'object' && payload !== null && 'message' in payload) {
      const raw = (payload as { message: unknown }).message;
      if (Array.isArray(raw)) {
        return {
          status,
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Some of the information provided is not valid.',
          details: raw.map((message) => this.toDetail(String(message))),
        };
      }
    }

    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      return {
        status,
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Too many requests. Please wait a moment and try again.',
      };
    }

    const codeByStatus: Record<number, string> = {
      [HttpStatus.UNAUTHORIZED]: ERROR_CODES.UNAUTHENTICATED,
      [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
      [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
      [HttpStatus.CONFLICT]: ERROR_CODES.CONFLICT,
    };

    return {
      status,
      code: codeByStatus[status] ?? ERROR_CODES.INTERNAL_ERROR,
      message: exception.message,
    };
  }

  private fromPrisma(exception: Prisma.PrismaClientKnownRequestError): Normalised {
    switch (exception.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          code: ERROR_CODES.CONFLICT,
          message: 'That record already exists.',
          internal: exception.meta,
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          code: ERROR_CODES.NOT_FOUND,
          message: 'The requested record was not found.',
        };
      case 'P2003':
        return {
          status: HttpStatus.CONFLICT,
          code: ERROR_CODES.CONFLICT,
          message: 'That change would break a link to another record.',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'Something went wrong on our side. Please try again.',
          internal: exception,
        };
    }
  }

  /** class-validator messages start with the property name: "email must be…". */
  private toDetail(message: string): ApiErrorDetail {
    const field = message.split(' ')[0];
    return field && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(field) ? { field, message } : { message };
  }
}

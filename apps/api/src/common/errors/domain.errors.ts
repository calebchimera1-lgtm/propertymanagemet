import { ERROR_CODES, type ErrorCode } from '@pm/types';

/**
 * Domain errors carry a stable machine-readable code and an HTTP status.
 * Services throw these; the global exception filter turns them into the single
 * error envelope every endpoint returns.
 */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode | string,
    message: string,
    readonly status: number,
    readonly details?: { field?: string; message: string }[],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string) {
    super(ERROR_CODES.NOT_FOUND, `${entity} not found.`, 404);
  }
}

export class ConflictError extends DomainError {
  constructor(code: ErrorCode | string, message: string, details?: { field?: string; message: string }[]) {
    super(code, message, 409, details);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: { field?: string; message: string }[]) {
    super(ERROR_CODES.VALIDATION_FAILED, message, 422, details);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(ERROR_CODES.FORBIDDEN, message, 403);
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(code: ErrorCode = ERROR_CODES.UNAUTHENTICATED, message = 'Authentication required.') {
    super(code, message, 401);
  }
}

/**
 * Thrown when a tenant-scoped query runs with no tenant context. This is always
 * a programming error — a background job or test using the scoped client
 * instead of the unscoped one — and it must fail loudly rather than quietly
 * querying across organizations.
 */
export class TenantContextMissingError extends Error {
  constructor() {
    super(
      'Tenant context is missing. A tenant-scoped query ran outside a request. ' +
        'Use the unscoped PrismaService for jobs, seeds and auth lookups.',
    );
    this.name = 'TenantContextMissingError';
  }
}

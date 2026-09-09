/** Uniform error envelope returned by every API endpoint (blueprint §12). */
export interface ApiErrorResponse {
  statusCode: number;
  error: string;
  /** Stable machine-readable code the frontend maps to friendly copy. */
  code: string;
  message: string;
  details?: ApiErrorDetail[];
  timestamp: string;
  path: string;
  requestId: string;
}

export interface ApiErrorDetail {
  field?: string;
  message: string;
}

/** Uniform envelope for every paginated list endpoint. */
export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type SortOrder = 'asc' | 'desc';

/** Stable error codes. The message may change; the code may not. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  CSRF_TOKEN_INVALID: 'CSRF_TOKEN_INVALID',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  ORGANIZATION_NAME_TAKEN: 'ORGANIZATION_NAME_TAKEN',
  INVALID_TOKEN: 'INVALID_TOKEN',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

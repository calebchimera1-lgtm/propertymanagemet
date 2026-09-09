import type { ApiErrorDetail, ApiErrorResponse } from '@pm/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
const CSRF_COOKIE = 'pm.csrf';

/**
 * The error every failed request throws.
 *
 * `code` is stable and safe to branch on; `message` is written for a person and
 * may change. `details` carries field-level messages that forms can attach to
 * the right input.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiErrorDetail[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field name → message, for React Hook Form's setError. */
  get fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const detail of this.details) {
      if (detail.field && !map[detail.field]) map[detail.field] = detail.message;
    }
    return map;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

function readCsrfCookie(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.split('; ').find((row) => row.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : '';
}

const UNSAFE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
}

/**
 * The single door to the API.
 *
 * Always sends cookies, always attaches the CSRF header on unsafe methods, and
 * always turns a failure into an ApiError. No component builds its own fetch.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, headers, ...rest } = options;
  const method = (rest.method ?? 'GET').toUpperCase();

  const url = new URL(`${API_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
  if (UNSAFE_METHODS.has(method)) requestHeaders.set('X-CSRF-Token', readCsrfCookie());

  const response = await fetch(url.toString(), {
    ...rest,
    method,
    headers: requestHeaders,
    // Without this the session cookie is never sent and every call is anonymous.
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = (payload ?? {}) as Partial<ApiErrorResponse>;
    throw new ApiError(
      response.status,
      error.code ?? 'UNKNOWN_ERROR',
      error.message ?? 'Something went wrong. Please try again.',
      error.details ?? [],
      error.requestId,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => apiFetch<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'DELETE' }),
};

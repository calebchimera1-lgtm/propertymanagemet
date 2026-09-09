import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api-client';

/** noUncheckedIndexedAccess makes mock.calls[0] possibly-undefined; assert once here. */
function callArgs(mock: { mock: { calls: unknown[][] } }, index = 0): [string, RequestInit] {
  const call = mock.mock.calls[index];
  if (!call) throw new Error(`fetch was not called ${index + 1} time(s)`);
  return call as [string, RequestInit];
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiFetch', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    document.cookie = 'pm.csrf=csrf-token-value';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('always sends cookies', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    await api.get('/auth/me');

    const [, init] = callArgs(fetchMock);
    // Without credentials:'include' the session cookie is never sent and every
    // request is anonymous.
    expect(init.credentials).toBe('include');
  });

  it('attaches the CSRF header on unsafe methods only', async () => {
    // A fresh Response per call: a Response body can only be read once.
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, {})));

    await api.post('/auth/logout');
    const [, postInit] = callArgs(fetchMock);
    expect((postInit.headers as Headers).get('X-CSRF-Token')).toBe('csrf-token-value');

    fetchMock.mockClear();
    await api.get('/auth/me');
    const [, getInit] = callArgs(fetchMock);
    expect((getInit.headers as Headers).get('X-CSRF-Token')).toBeNull();
  });

  it('turns an error envelope into an ApiError with a stable code', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        statusCode: 403,
        error: 'Forbidden',
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action.',
        timestamp: '2026-09-09T00:00:00.000Z',
        path: '/api/v1/organization',
        requestId: 'req-123',
      }),
    );

    await expect(api.patch('/organization', { city: 'Nairobi' })).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      requestId: 'req-123',
    });
  });

  it('exposes field errors so a form can attach them to inputs', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(422, {
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: 'WEAK_PASSWORD',
        message: 'That password does not meet the security requirements.',
        details: [
          { field: 'password', message: 'Password must be at least 12 characters.' },
          { field: 'password', message: 'Password must contain a number.' },
        ],
        timestamp: '2026-09-09T00:00:00.000Z',
        path: '/api/v1/auth/register',
        requestId: 'req-456',
      }),
    );

    try {
      await api.post('/auth/register', {});
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.fieldErrors.password).toBe('Password must be at least 12 characters.');
    }
  });

  it('recognises an authentication failure', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { statusCode: 401, code: 'UNAUTHENTICATED', message: 'Sign in.' }),
    );

    try {
      await api.get('/auth/me');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ApiError).isUnauthenticated).toBe(true);
    }
  });

  it('returns undefined for a 204 rather than trying to parse a body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.delete('/auth/sessions/abc')).resolves.toBeUndefined();
  });

  it('drops empty query parameters instead of sending search=', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await api.get('/users', { query: { page: 1, search: '', limit: 20 } });

    const [url] = callArgs(fetchMock);
    expect(url).toContain('page=1');
    expect(url).toContain('limit=20');
    expect(url).not.toContain('search=');
  });
});

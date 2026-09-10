import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

export const BASE = '/api/v1';

export interface SignedIn {
  cookies: string[];
  csrfToken: string;
  userId: string;
  organizationId: string;
  email: string;
}

function parseCookies(header: string | string[] | undefined): string[] {
  if (!header) return [];
  return (Array.isArray(header) ? header : [header]).map((cookie) => cookie.split(';')[0] ?? '');
}

function readCookie(cookies: string[], name: string): string {
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

export async function registerOrganization(
  app: NestExpressApplication,
  input: { organizationName: string; fullName: string; email: string; password: string },
): Promise<SignedIn> {
  const response = await request(app.getHttpServer())
    .post(`${BASE}/auth/register`)
    .send(input)
    .expect(201);

  const cookies = parseCookies(response.headers['set-cookie']);
  return {
    cookies,
    csrfToken: readCookie(cookies, 'pm.csrf'),
    userId: response.body.user.id,
    organizationId: response.body.organization.id,
    email: response.body.user.email,
  };
}

export async function signIn(
  app: NestExpressApplication,
  email: string,
  password: string,
): Promise<SignedIn> {
  const response = await request(app.getHttpServer())
    .post(`${BASE}/auth/login`)
    .send({ email, password })
    .expect(200);

  const cookies = parseCookies(response.headers['set-cookie']);
  return {
    cookies,
    csrfToken: readCookie(cookies, 'pm.csrf'),
    userId: response.body.user.id,
    organizationId: response.body.organization.id,
    email: response.body.user.email,
  };
}

export function authed(app: NestExpressApplication, session: SignedIn) {
  return {
    get: (path: string) =>
      request(app.getHttpServer()).get(`${BASE}${path}`).set('Cookie', session.cookies),
    post: (path: string) =>
      request(app.getHttpServer())
        .post(`${BASE}${path}`)
        .set('Cookie', session.cookies)
        .set('X-CSRF-Token', session.csrfToken),
    patch: (path: string) =>
      request(app.getHttpServer())
        .patch(`${BASE}${path}`)
        .set('Cookie', session.cookies)
        .set('X-CSRF-Token', session.csrfToken),
    delete: (path: string) =>
      request(app.getHttpServer())
        .delete(`${BASE}${path}`)
        .set('Cookie', session.cookies)
        .set('X-CSRF-Token', session.csrfToken),
    put: (path: string) =>
      request(app.getHttpServer())
        .put(`${BASE}${path}`)
        .set('Cookie', session.cookies)
        .set('X-CSRF-Token', session.csrfToken),
    /** Same as post()/patch(), but deliberately without the CSRF header. */
    postWithoutCsrf: (path: string) =>
      request(app.getHttpServer()).post(`${BASE}${path}`).set('Cookie', session.cookies),
    patchWithoutCsrf: (path: string) =>
      request(app.getHttpServer()).patch(`${BASE}${path}`).set('Cookie', session.cookies),
  };
}

export const STRONG_PASSWORD = 'CorrectHorseBattery9';

import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { BASE, type SignedIn } from './api-client';

/** Byte prefixes the upload validator recognises, so a fixture is a real file. */
export const PDF_BYTES = Buffer.from('%PDF-1.7\nfixture\n');
export const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fixture'),
]);

/**
 * Posts a multipart upload.
 *
 * Written by hand rather than through `authed()` because supertest's `.attach()`
 * and `.field()` cannot be mixed with `.send()`, and the CSRF header still has
 * to go on.
 */
export function upload(
  app: NestExpressApplication,
  session: SignedIn,
  file: { name: string; bytes: Buffer; type: string },
  fields: Record<string, string>,
) {
  const req = request(app.getHttpServer())
    .post(`${BASE}/documents`)
    .set('Cookie', session.cookies)
    .set('X-CSRF-Token', session.csrfToken)
    .attach('file', file.bytes, { filename: file.name, contentType: file.type });

  for (const [key, value] of Object.entries(fields)) req.field(key, value);
  return req;
}

export function download(app: NestExpressApplication, session: SignedIn | null, id: string) {
  const req = request(app.getHttpServer()).get(`${BASE}/documents/${id}/download`);
  return session ? req.set('Cookie', session.cookies) : req;
}

import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaService } from '@/prisma/prisma.service';
import { STRONG_PASSWORD, type SignedIn, authed, registerOrganization } from './helpers/api-client';
import { createTestApp, resetDatabase } from './helpers/test-app';

/**
 * The suite that matters most.
 *
 * Two organizations exist for the whole file. Every assertion is a variation on
 * one question: can ABC see, change or even confirm the existence of anything
 * belonging to XYZ? The answer must be no, and it must be a 404 rather than a
 * 403 — a 403 would confirm the record is real.
 *
 * Every endpoint added in a later phase gets a row here before it is considered
 * done.
 */
describe('Organization isolation (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let abc: SignedIn;
  let xyz: SignedIn;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);

    abc = await registerOrganization(app, {
      organizationName: 'ABC Properties',
      fullName: 'Amina Ochieng',
      email: 'owner@abc.test',
      password: STRONG_PASSWORD,
    });
    xyz = await registerOrganization(app, {
      organizationName: 'XYZ Estates',
      fullName: 'Esther Njeri',
      email: 'owner@xyz.test',
      password: STRONG_PASSWORD,
    });
  });

  it('gives the two organizations different ids', () => {
    expect(abc.organizationId).not.toBe(xyz.organizationId);
  });

  describe('reads', () => {
    it('GET /auth/me returns only the caller\'s own organization', async () => {
      const response = await authed(app, abc).get('/auth/me').expect(200);
      expect(response.body.organization.id).toBe(abc.organizationId);
      expect(response.body.organization.name).toBe('ABC Properties');
    });

    it('GET /organization never returns the other organization', async () => {
      const response = await authed(app, abc).get('/organization').expect(200);
      expect(response.body.id).toBe(abc.organizationId);
      expect(response.body.name).not.toBe('XYZ Estates');
    });

    it('GET /users lists only users of the caller\'s organization', async () => {
      const response = await authed(app, abc).get('/users').expect(200);

      expect(response.body.meta.total).toBe(1);
      expect(response.body.data.map((u: { email: string }) => u.email)).toEqual(['owner@abc.test']);
      expect(JSON.stringify(response.body)).not.toContain('owner@xyz.test');
    });

    it('GET /users/:id returns 404 — not 403 — for a foreign user', async () => {
      const response = await authed(app, abc).get(`/users/${xyz.userId}`).expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
      // A 403 here would confirm the record exists.
      expect(response.body.statusCode).not.toBe(403);
    });

    it('GET /settings returns the caller\'s own settings row', async () => {
      const response = await authed(app, abc).get('/settings').expect(200);
      expect(response.body.organizationId).toBe(abc.organizationId);
    });
  });

  describe('writes', () => {
    it('PATCH /organization changes only the caller\'s organization', async () => {
      await authed(app, abc).patch('/organization').send({ city: 'Nairobi' }).expect(200);

      const other = await prisma.organization.findUniqueOrThrow({
        where: { id: xyz.organizationId },
      });
      expect(other.city).toBeNull();
    });

    it('cannot smuggle an organizationId through a request body', async () => {
      const response = await authed(app, abc)
        .patch('/organization')
        .send({ city: 'Nairobi', organizationId: xyz.organizationId })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');

      const other = await prisma.organization.findUniqueOrThrow({
        where: { id: xyz.organizationId },
      });
      expect(other.city).toBeNull();
    });

    it('cannot revoke a session belonging to another organization', async () => {
      const foreignSession = await prisma.session.findFirstOrThrow({
        where: { organizationId: xyz.organizationId },
      });

      await authed(app, abc).delete(`/auth/sessions/${foreignSession.id}`).expect(404);

      const stillLive = await prisma.session.findUniqueOrThrow({
        where: { id: foreignSession.id },
      });
      expect(stillLive.revokedAt).toBeNull();
      await authed(app, xyz).get('/auth/me').expect(200);
    });

    it('PATCH /settings changes only the caller\'s settings', async () => {
      await authed(app, abc).patch('/settings').send({ defaultDueDay: 10 }).expect(200);

      const other = await prisma.settings.findUniqueOrThrow({
        where: { organizationId: xyz.organizationId },
      });
      expect(other.defaultDueDay).toBe(5);
    });
  });

  describe('the tenant-scoped Prisma client', () => {
    it('refuses to run a tenant query with no tenant context', async () => {
      const { createTenantScopedClient } = await import('@/prisma/tenant-scope.extension');
      const { TenantContextService } = await import('@/tenancy/tenant-context.service');

      // A client whose context service has no active store — exactly what a
      // background job would see if it grabbed the wrong client.
      const scoped = createTenantScopedClient(prisma, new TenantContextService());

      await expect(scoped.user.findMany()).rejects.toThrow(/Tenant context is missing/);
    });
  });
});

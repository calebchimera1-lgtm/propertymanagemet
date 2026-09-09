import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '@/prisma/prisma.service';
import { BASE, STRONG_PASSWORD, authed, registerOrganization, signIn } from './helpers/api-client';
import { createTestApp, resetDatabase } from './helpers/test-app';

describe('Authentication (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const owner = {
    organizationName: 'Sunrise Estates',
    fullName: 'Amina Ochieng',
    email: 'owner@sunrise.test',
    password: STRONG_PASSWORD,
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  describe('registration', () => {
    it('creates the organization, the owner and the settings row atomically', async () => {
      const session = await registerOrganization(app, owner);

      const organization = await prisma.organization.findUnique({
        where: { id: session.organizationId },
        include: { settings: true, users: { include: { roles: { include: { role: true } } } } },
      });

      expect(organization?.name).toBe('Sunrise Estates');
      expect(organization?.code).toMatch(/^[A-Z0-9]{3,12}$/);
      expect(organization?.settings).not.toBeNull();
      expect(organization?.users).toHaveLength(1);
      expect(organization?.users[0]?.roles[0]?.role.name).toBe('PROPERTY_OWNER');
    });

    it('issues a session cookie that is HttpOnly, SameSite=Lax and scoped to /', async () => {
      const response = await request(app.getHttpServer())
        .post(`${BASE}/auth/register`)
        .send(owner)
        .expect(201);

      const cookies = response.headers['set-cookie'] as unknown as string[];
      const sessionCookie = cookies.find((cookie) => cookie.startsWith('pm.sid='));
      const csrfCookie = cookies.find((cookie) => cookie.startsWith('pm.csrf='));

      expect(sessionCookie).toContain('HttpOnly');
      expect(sessionCookie).toContain('SameSite=Lax');
      expect(sessionCookie).toContain('Path=/');
      // The CSRF cookie must be readable by the client — it is echoed in a header.
      expect(csrfCookie).not.toContain('HttpOnly');
    });

    it('never returns the password hash', async () => {
      const response = await request(app.getHttpServer())
        .post(`${BASE}/auth/register`)
        .send(owner)
        .expect(201);

      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
      expect(JSON.stringify(response.body)).not.toContain('$argon2');
    });

    it('stores an Argon2id hash, not the password', async () => {
      await registerOrganization(app, owner);
      const user = await prisma.user.findUnique({ where: { email: owner.email } });

      expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user?.passwordHash).not.toContain(STRONG_PASSWORD);
    });

    it('rejects a weak password with field-level detail', async () => {
      const response = await request(app.getHttpServer())
        .post(`${BASE}/auth/register`)
        .send({ ...owner, password: 'short' })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(response.body.details.some((d: { field?: string }) => d.field === 'password')).toBe(true);
    });

    it('rejects a password that contains the email local part', async () => {
      const response = await request(app.getHttpServer())
        .post(`${BASE}/auth/register`)
        .send({ ...owner, password: 'Owner123456789' })
        .expect(422);

      expect(response.body.code).toBe('WEAK_PASSWORD');
    });

    it('refuses a duplicate email address', async () => {
      await registerOrganization(app, owner);
      const response = await request(app.getHttpServer())
        .post(`${BASE}/auth/register`)
        .send({ ...owner, organizationName: 'Another Company' })
        .expect(409);

      expect(response.body.code).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('gives each organization a distinct code even when names collide', async () => {
      const first = await registerOrganization(app, owner);
      const second = await registerOrganization(app, {
        ...owner,
        email: 'second@sunrise.test',
      });

      const codes = await prisma.organization.findMany({
        where: { id: { in: [first.organizationId, second.organizationId] } },
        select: { code: true },
      });
      expect(new Set(codes.map((c) => c.code)).size).toBe(2);
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await registerOrganization(app, owner);
    });

    it('signs in with the right password', async () => {
      const response = await request(app.getHttpServer())
        .post(`${BASE}/auth/login`)
        .send({ email: owner.email, password: owner.password })
        .expect(200);

      expect(response.body.user.email).toBe(owner.email);
      expect(response.body.roles).toEqual(['PROPERTY_OWNER']);
      expect(response.body.permissions.length).toBeGreaterThan(40);
    });

    it('is case-insensitive about the email address', async () => {
      await request(app.getHttpServer())
        .post(`${BASE}/auth/login`)
        .send({ email: 'OWNER@SUNRISE.TEST', password: owner.password })
        .expect(200);
    });

    it('answers a wrong password and an unknown email identically', async () => {
      const wrongPassword = await request(app.getHttpServer())
        .post(`${BASE}/auth/login`)
        .send({ email: owner.email, password: 'NotThePassword9' })
        .expect(401);

      const unknownEmail = await request(app.getHttpServer())
        .post(`${BASE}/auth/login`)
        .send({ email: 'nobody@nowhere.test', password: 'NotThePassword9' })
        .expect(401);

      // Identical code and message: the response must not become an
      // account-enumeration oracle.
      expect(wrongPassword.body.code).toBe(unknownEmail.body.code);
      expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    });

    it('locks the account after ten failed attempts and says so', async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        await request(app.getHttpServer())
          .post(`${BASE}/auth/login`)
          .send({ email: owner.email, password: 'NotThePassword9' })
          .expect(401);
      }

      const locked = await request(app.getHttpServer())
        .post(`${BASE}/auth/login`)
        .send({ email: owner.email, password: owner.password })
        .expect(423);

      expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    });

    it('resets the failure counter after a successful sign-in', async () => {
      await request(app.getHttpServer())
        .post(`${BASE}/auth/login`)
        .send({ email: owner.email, password: 'NotThePassword9' })
        .expect(401);

      await signIn(app, owner.email, owner.password);

      const user = await prisma.user.findUnique({ where: { email: owner.email } });
      expect(user?.failedLoginCount).toBe(0);
    });

    it('stores only a hash of the session token', async () => {
      const session = await signIn(app, owner.email, owner.password);
      const rawToken = session.cookies
        .find((cookie) => cookie.startsWith('pm.sid='))
        ?.slice('pm.sid='.length);

      // Two sessions exist: registration issued one, this sign-in another.
      const rows = await prisma.session.findMany({ select: { tokenHash: true } });
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.tokenHash).toHaveLength(64); // sha256 hex
        expect(row.tokenHash).not.toBe(rawToken);
      }
    });
  });

  describe('session lifecycle', () => {
    it('rejects an unauthenticated request', async () => {
      const response = await request(app.getHttpServer()).get(`${BASE}/auth/me`).expect(401);
      expect(response.body.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a forged session cookie', async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/auth/me`)
        .set('Cookie', ['pm.sid=totally-made-up-token'])
        .expect(401);
    });

    it('stops accepting the cookie after logout', async () => {
      const session = await registerOrganization(app, owner);
      await authed(app, session).get('/auth/me').expect(200);
      await authed(app, session).post('/auth/logout').expect(204);
      await authed(app, session).get('/auth/me').expect(401);
    });

    it('rejects a session whose expiry has passed', async () => {
      const session = await registerOrganization(app, owner);
      await prisma.session.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const response = await authed(app, session).get('/auth/me').expect(401);
      expect(response.body.code).toBe('SESSION_EXPIRED');
    });

    it('lists and revokes individual sessions', async () => {
      await registerOrganization(app, owner);
      const first = await signIn(app, owner.email, owner.password);
      const second = await signIn(app, owner.email, owner.password);

      const list = await authed(app, first).get('/auth/sessions').expect(200);
      expect(list.body).toHaveLength(3); // registration + two sign-ins
      expect(list.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

      const secondId = list.body.find((s: { current: boolean }) => !s.current).id;
      await authed(app, first).delete(`/auth/sessions/${secondId}`).expect(204);

      // The revoked one is gone; the caller's own session still works.
      await authed(app, first).get('/auth/me').expect(200);
      const remaining = await authed(app, first).get('/auth/sessions').expect(200);
      expect(remaining.body).toHaveLength(2);
      void second;
    });

    it('signs out everywhere', async () => {
      await registerOrganization(app, owner);
      const first = await signIn(app, owner.email, owner.password);
      const second = await signIn(app, owner.email, owner.password);

      await authed(app, first).post('/auth/logout-all').expect(201);

      await authed(app, first).get('/auth/me').expect(401);
      await authed(app, second).get('/auth/me').expect(401);
    });
  });

  describe('CSRF', () => {
    it('refuses an unsafe request without the header', async () => {
      const session = await registerOrganization(app, owner);
      const response = await authed(app, session)
        .patchWithoutCsrf('/auth/profile')
        .send({ fullName: 'New Name' })
        .expect(403);

      expect(response.body.code).toBe('CSRF_TOKEN_INVALID');
    });

    it('refuses a wrong token', async () => {
      const session = await registerOrganization(app, owner);
      await request(app.getHttpServer())
        .patch(`${BASE}/auth/profile`)
        .set('Cookie', session.cookies)
        .set('X-CSRF-Token', 'a'.repeat(64))
        .send({ fullName: 'New Name' })
        .expect(403);
    });

    it("refuses another session's token", async () => {
      const first = await registerOrganization(app, owner);
      const second = await registerOrganization(app, {
        ...owner,
        organizationName: 'Other Co',
        email: 'other@other.test',
      });

      await request(app.getHttpServer())
        .patch(`${BASE}/auth/profile`)
        .set('Cookie', first.cookies)
        .set('X-CSRF-Token', second.csrfToken)
        .send({ fullName: 'New Name' })
        .expect(403);
    });

    it('allows the matching token', async () => {
      const session = await registerOrganization(app, owner);
      await authed(app, session).patch('/auth/profile').send({ fullName: 'Amina O.' }).expect(200);
    });

    it('never applies to safe methods', async () => {
      const session = await registerOrganization(app, owner);
      await request(app.getHttpServer())
        .get(`${BASE}/auth/me`)
        .set('Cookie', session.cookies)
        .expect(200);
    });
  });

  describe('password lifecycle', () => {
    it('changes the password and signs out every other session', async () => {
      await registerOrganization(app, owner);
      const current = await signIn(app, owner.email, owner.password);
      const other = await signIn(app, owner.email, owner.password);

      await authed(app, current)
        .post('/auth/change-password')
        .send({ currentPassword: owner.password, newPassword: 'BrandNewSecret42' })
        .expect(200);

      // The session that made the change survives; the others do not.
      await authed(app, current).get('/auth/me').expect(200);
      await authed(app, other).get('/auth/me').expect(401);

      await signIn(app, owner.email, 'BrandNewSecret42');
    });

    it('refuses a password change with the wrong current password', async () => {
      const session = await registerOrganization(app, owner);
      const response = await authed(app, session)
        .post('/auth/change-password')
        .send({ currentPassword: 'WrongCurrent123', newPassword: 'BrandNewSecret42' })
        .expect(422);

      expect(response.body.details[0].field).toBe('currentPassword');
    });

    it('refuses reusing the same password', async () => {
      const session = await registerOrganization(app, owner);
      await authed(app, session)
        .post('/auth/change-password')
        .send({ currentPassword: owner.password, newPassword: owner.password })
        .expect(422);
    });

    it('answers forgot-password identically for known and unknown addresses', async () => {
      await registerOrganization(app, owner);

      const known = await request(app.getHttpServer())
        .post(`${BASE}/auth/forgot-password`)
        .send({ email: owner.email })
        .expect(202);
      const unknown = await request(app.getHttpServer())
        .post(`${BASE}/auth/forgot-password`)
        .send({ email: 'nobody@nowhere.test' })
        .expect(202);

      expect(known.body).toEqual(unknown.body);
    });

    it('resets the password with a valid token and revokes every session', async () => {
      const session = await registerOrganization(app, owner);
      await request(app.getHttpServer())
        .post(`${BASE}/auth/forgot-password`)
        .send({ email: owner.email })
        .expect(202);

      // The stored value is a hash, so the raw token has to be recreated the
      // same way the service would receive it. Instead we assert the shape and
      // drive the flow through a token we plant with a known hash.
      const { createHash, randomBytes } = await import('node:crypto');
      const raw = randomBytes(32).toString('base64url');
      const user = await prisma.user.findUniqueOrThrow({ where: { email: owner.email } });
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: createHash('sha256').update(raw).digest('hex'),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      await request(app.getHttpServer())
        .post(`${BASE}/auth/reset-password`)
        .send({ token: raw, password: 'ResetSecret12345' })
        .expect(200);

      // Everyone is signed out, including whoever requested the reset.
      await authed(app, session).get('/auth/me').expect(401);
      await signIn(app, owner.email, 'ResetSecret12345');

      // The token is single-use.
      await request(app.getHttpServer())
        .post(`${BASE}/auth/reset-password`)
        .send({ token: raw, password: 'AnotherSecret123' })
        .expect(400);
    });

    it('refuses an expired reset token', async () => {
      await registerOrganization(app, owner);
      const { createHash, randomBytes } = await import('node:crypto');
      const raw = randomBytes(32).toString('base64url');
      const user = await prisma.user.findUniqueOrThrow({ where: { email: owner.email } });
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: createHash('sha256').update(raw).digest('hex'),
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      const response = await request(app.getHttpServer())
        .post(`${BASE}/auth/reset-password`)
        .send({ token: raw, password: 'ResetSecret12345' })
        .expect(400);
      expect(response.body.code).toBe('INVALID_TOKEN');
    });
  });

  describe('audit trail', () => {
    it('records registration, sign-in and sign-out without leaking secrets', async () => {
      const session = await registerOrganization(app, owner);
      await authed(app, session).post('/auth/logout').expect(204);

      const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
      const actions = logs.map((log) => log.action);

      expect(actions).toContain('ORGANIZATION_CREATED');
      expect(actions).toContain('USER_REGISTERED');
      expect(actions).toContain('LOGOUT');

      const serialised = JSON.stringify(logs);
      expect(serialised).not.toContain(STRONG_PASSWORD);
      expect(serialised).not.toContain('$argon2');
    });

    it('records a failed sign-in attempt', async () => {
      await registerOrganization(app, owner);
      await request(app.getHttpServer())
        .post(`${BASE}/auth/login`)
        .send({ email: owner.email, password: 'NotThePassword9' })
        .expect(401);

      const failures = await prisma.auditLog.findMany({ where: { action: 'LOGIN_FAILED' } });
      expect(failures).toHaveLength(1);
    });
  });
});

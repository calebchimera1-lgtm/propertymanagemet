import type { NestExpressApplication } from '@nestjs/platform-express';
import { ROLE_PERMISSIONS, type RoleName } from '@pm/types';
import * as argon2 from 'argon2';
import type { PrismaService } from '@/prisma/prisma.service';
import { STRONG_PASSWORD, type SignedIn, authed, registerOrganization, signIn } from './helpers/api-client';
import { createTestApp, resetDatabase } from './helpers/test-app';

/**
 * Table-driven check of the RBAC matrix (blueprint §8) against real HTTP.
 *
 * The point is not that the code compiles: it is that a caretaker calling an
 * owner-only endpoint gets a 403 from the server, no matter what the UI does.
 */
describe('Permissions (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: SignedIn;

  const ROLES_UNDER_TEST: RoleName[] = [
    'PROPERTY_OWNER',
    'PROPERTY_MANAGER',
    'ACCOUNTANT',
    'CARETAKER',
  ];

  /** Endpoint → the permission it declares. */
  const ENDPOINTS = [
    { method: 'GET' as const, path: '/organization', permission: 'settings.view' },
    { method: 'GET' as const, path: '/settings', permission: 'settings.view' },
    { method: 'GET' as const, path: '/users', permission: 'staff.view' },
    { method: 'GET' as const, path: '/roles', permission: 'staff.view' },
    { method: 'GET' as const, path: '/permissions', permission: 'staff.view' },
  ];

  async function createUserWithRole(role: RoleName): Promise<SignedIn> {
    const email = `${role.toLowerCase()}@abc.test`;
    const passwordHash = await argon2.hash(STRONG_PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 8192,
      timeCost: 2,
      parallelism: 1,
    });

    const user = await prisma.user.create({
      data: {
        organizationId: owner.organizationId,
        email,
        passwordHash,
        fullName: `${role} User`,
        status: 'ACTIVE',
      },
    });
    const roleRow = await prisma.role.findFirstOrThrow({ where: { name: role, organizationId: null } });
    await prisma.userRole.create({
      data: { userId: user.id, roleId: roleRow.id, organizationId: owner.organizationId },
    });

    return signIn(app, email, STRONG_PASSWORD);
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    owner = await registerOrganization(app, {
      organizationName: 'ABC Properties',
      fullName: 'Amina Ochieng',
      email: 'owner@abc.test',
      password: STRONG_PASSWORD,
    });
  });

  describe.each(ROLES_UNDER_TEST)('as %s', (role) => {
    it.each(ENDPOINTS)(
      '$method $path is allowed only when the role holds $permission',
      async ({ path, permission }) => {
        const session = role === 'PROPERTY_OWNER' ? owner : await createUserWithRole(role);
        const shouldBeAllowed = (ROLE_PERMISSIONS[role] as string[]).includes(permission);

        const response = await authed(app, session).get(path);

        if (shouldBeAllowed) {
          expect(response.status).toBe(200);
        } else {
          expect(response.status).toBe(403);
          expect(response.body.code).toBe('FORBIDDEN');
        }
      },
    );
  });

  it('gives every role exactly the permissions the matrix says', async () => {
    for (const role of ROLES_UNDER_TEST) {
      const session = role === 'PROPERTY_OWNER' ? owner : await createUserWithRole(role);
      const response = await authed(app, session).get('/auth/me').expect(200);

      expect(new Set(response.body.permissions)).toEqual(new Set(ROLE_PERMISSIONS[role]));
      expect(response.body.roles).toEqual([role]);
    }
  });

  it('refuses a write to an endpoint the role cannot reach, even with a valid CSRF token', async () => {
    const caretaker = await createUserWithRole('CARETAKER');
    const response = await authed(app, caretaker)
      .patch('/organization')
      .send({ city: 'Nairobi' })
      .expect(403);

    expect(response.body.code).toBe('FORBIDDEN');
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: owner.organizationId },
    });
    expect(organization.city).toBeNull();
  });

  it('never reports permissions the user does not hold', async () => {
    const accountant = await createUserWithRole('ACCOUNTANT');
    const response = await authed(app, accountant).get('/auth/me').expect(200);

    expect(response.body.permissions).not.toContain('staff.create');
    expect(response.body.permissions).not.toContain('payments.void');
    expect(response.body.permissions).not.toContain('organization.update');
  });
});

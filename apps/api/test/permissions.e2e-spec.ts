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
    { method: 'GET' as const, path: '/properties', permission: 'properties.view' },
    { method: 'GET' as const, path: '/buildings', permission: 'buildings.view' },
    { method: 'GET' as const, path: '/units', permission: 'units.view' },
    { method: 'GET' as const, path: '/units/vacant', permission: 'units.view' },
    { method: 'GET' as const, path: '/tenants', permission: 'tenants.view' },
    { method: 'GET' as const, path: '/leases', permission: 'leases.view' },
    { method: 'GET' as const, path: '/leases/expiring', permission: 'leases.view' },
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

  describe('portfolio writes', () => {
    it('lets a manager create a property but not delete one', async () => {
      const manager = await createUserWithRole('PROPERTY_MANAGER');

      const created = await authed(app, manager)
        .post('/properties')
        .send({ name: 'Manager Estate', propertyType: 'APARTMENT' })
        .expect(201);

      // properties.delete is owner-only in the matrix — the manager archives.
      await authed(app, manager).delete(`/properties/${created.body.id}`).expect(403);
      await authed(app, manager).post(`/properties/${created.body.id}/archive`).expect(201);
    });

    it('refuses a caretaker every portfolio write except a unit status', async () => {
      const property = await authed(app, owner)
        .post('/properties')
        .send({ name: 'Owner Estate', propertyType: 'APARTMENT' })
        .expect(201);
      const unit = await authed(app, owner)
        .post('/units')
        .send({
          propertyId: property.body.id,
          unitNumber: 'A1',
          unitType: 'ONE_BEDROOM',
          monthlyRent: '10000',
        })
        .expect(201);

      const caretaker = await createUserWithRole('CARETAKER');
      await prisma.staffAssignment.create({
        data: {
          organizationId: owner.organizationId,
          userId: caretaker.userId,
          propertyId: property.body.id,
        },
      });
      const scoped = await signIn(app, 'caretaker@abc.test', STRONG_PASSWORD);

      await authed(app, scoped)
        .post('/properties')
        .send({ name: 'Caretaker Estate', propertyType: 'APARTMENT' })
        .expect(403);
      await authed(app, scoped)
        .post('/units')
        .send({
          propertyId: property.body.id,
          unitNumber: 'A2',
          unitType: 'ONE_BEDROOM',
          monthlyRent: '1000',
        })
        .expect(403);
      await authed(app, scoped).delete(`/units/${unit.body.id}`).expect(403);

      // units.update is granted, so the on-site status change is allowed.
      await authed(app, scoped)
        .patch(`/units/${unit.body.id}/status`)
        .send({ status: 'MAINTENANCE' })
        .expect(200);
    });

    it('lets a manager run the lease lifecycle but keeps deletion from them', async () => {
      const manager = await createUserWithRole('PROPERTY_MANAGER');

      const property = await authed(app, manager)
        .post('/properties')
        .send({ name: 'Manager Estate', propertyType: 'APARTMENT' })
        .expect(201);
      const unit = await authed(app, manager)
        .post('/units')
        .send({
          propertyId: property.body.id,
          unitNumber: 'M1',
          unitType: 'ONE_BEDROOM',
          monthlyRent: '30000',
        })
        .expect(201);
      const tenant = await authed(app, manager)
        .post('/tenants')
        .send({ fullName: 'Managed Tenant', phone: '+254700123456' })
        .expect(201);

      const lease = await authed(app, manager)
        .post('/leases')
        .send({ tenantId: tenant.body.id, unitId: unit.body.id, startDate: '2026-01-01', dueDay: 5 })
        .expect(201);

      await authed(app, manager)
        .post(`/leases/${lease.body.id}/terminate`)
        .send({ reason: 'Done' })
        .expect(201);

      // tenants.delete is owner-only in the matrix.
      await authed(app, manager).delete(`/tenants/${tenant.body.id}`).expect(403);
    });

    it('refuses a caretaker and an accountant every occupancy write', async () => {
      const property = await authed(app, owner)
        .post('/properties')
        .send({ name: 'Owner Estate', propertyType: 'APARTMENT' })
        .expect(201);
      const unit = await authed(app, owner)
        .post('/units')
        .send({
          propertyId: property.body.id,
          unitNumber: 'A1',
          unitType: 'ONE_BEDROOM',
          monthlyRent: '10000',
        })
        .expect(201);

      for (const role of ['CARETAKER', 'ACCOUNTANT'] as const) {
        const staff = await createUserWithRole(role);
        await prisma.staffAssignment.create({
          data: {
            organizationId: owner.organizationId,
            userId: staff.userId,
            propertyId: property.body.id,
          },
        });
        const scoped = await signIn(app, `${role.toLowerCase()}@abc.test`, STRONG_PASSWORD);

        // Both roles may see tenants and leases; neither may create them.
        await authed(app, scoped).get('/tenants').expect(200);
        await authed(app, scoped).get('/leases').expect(200);
        await authed(app, scoped)
          .post('/tenants')
          .send({ fullName: 'Sneaky Tenant', phone: '+254700999000' })
          .expect(403);
        await authed(app, scoped)
          .post('/leases')
          .send({ tenantId: 'anything', unitId: unit.body.id, startDate: '2026-01-01', dueDay: 5 })
          .expect(403);
      }
    });

    it('gives an accountant read access to the portfolio but no write access', async () => {
      const accountant = await createUserWithRole('ACCOUNTANT');

      await authed(app, accountant).get('/properties').expect(200);
      await authed(app, accountant).get('/units').expect(200);
      await authed(app, accountant)
        .post('/properties')
        .send({ name: 'Accountant Estate', propertyType: 'APARTMENT' })
        .expect(403);
      await authed(app, accountant)
        .post('/buildings')
        .send({ propertyId: 'anything', name: 'Block' })
        .expect(403);
    });
  });

  it('never reports permissions the user does not hold', async () => {
    const accountant = await createUserWithRole('ACCOUNTANT');
    const response = await authed(app, accountant).get('/auth/me').expect(200);

    expect(response.body.permissions).not.toContain('staff.create');
    expect(response.body.permissions).not.toContain('payments.void');
    expect(response.body.permissions).not.toContain('organization.update');
  });
});

import type { NestExpressApplication } from '@nestjs/platform-express';
import type { RoleName } from '@pm/types';
import * as argon2 from 'argon2';
import type { PrismaService } from '@/prisma/prisma.service';
import { STRONG_PASSWORD, type SignedIn, authed, registerOrganization, signIn } from './helpers/api-client';
import { createBuilding, createProperty, createUnit } from './helpers/portfolio';
import { createTestApp, resetDatabase } from './helpers/test-app';

/**
 * Layer 4 of the multi-tenant model: a caretaker or accountant sees only the
 * properties assigned to them.
 *
 * The most important test in this file is the last one — that a scoped user
 * with NO assignments sees nothing. The dangerous failure mode for a scoping
 * feature is not "shows too little", it is "an empty filter means no filter".
 */
describe('Property scope (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: SignedIn;
  let assigned: { id: string; name: string };
  let unassigned: { id: string; name: string };

  async function createStaff(role: RoleName, email: string): Promise<SignedIn> {
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
    const roleRow = await prisma.role.findFirstOrThrow({
      where: { name: role, organizationId: null },
    });
    await prisma.userRole.create({
      data: { userId: user.id, roleId: roleRow.id, organizationId: owner.organizationId },
    });

    return signIn(app, email, STRONG_PASSWORD);
  }

  async function assign(userEmail: string, propertyId: string): Promise<void> {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: userEmail } });
    await prisma.staffAssignment.create({
      data: { organizationId: owner.organizationId, userId: user.id, propertyId },
    });
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

    assigned = await createProperty(app, owner, { name: 'Assigned Estate' });
    unassigned = await createProperty(app, owner, { name: 'Unassigned Estate' });

    await createUnit(app, owner, assigned.id, { unitNumber: 'ASSIGNED-1' });
    await createUnit(app, owner, unassigned.id, { unitNumber: 'UNASSIGNED-1' });
    await createBuilding(app, owner, assigned.id, { name: 'Assigned Block' });
    await createBuilding(app, owner, unassigned.id, { name: 'Unassigned Block' });
  });

  it('leaves owners and managers unrestricted', async () => {
    const me = await authed(app, owner).get('/auth/me').expect(200);
    // null, not []: "unrestricted" and "restricted to nothing" must not be the
    // same value.
    expect(me.body.scopedPropertyIds).toBeNull();

    const properties = await authed(app, owner).get('/properties').expect(200);
    expect(properties.body.meta.total).toBe(2);
  });

  describe('a caretaker assigned to one property', () => {
    let caretaker: SignedIn;

    beforeEach(async () => {
      caretaker = await createStaff('CARETAKER', 'caretaker@abc.test');
      await assign('caretaker@abc.test', assigned.id);
      // Re-authenticate so the session carries the new assignment.
      caretaker = await signIn(app, 'caretaker@abc.test', STRONG_PASSWORD);
    });

    it('reports its scope on /auth/me', async () => {
      const me = await authed(app, caretaker).get('/auth/me').expect(200);
      expect(me.body.scopedPropertyIds).toEqual([assigned.id]);
    });

    it('lists only the assigned property', async () => {
      const response = await authed(app, caretaker).get('/properties').expect(200);
      expect(response.body.meta.total).toBe(1);
      expect(response.body.data[0].name).toBe('Assigned Estate');
    });

    it('gets 404 — not 403 — for the unassigned property', async () => {
      const response = await authed(app, caretaker)
        .get(`/properties/${unassigned.id}`)
        .expect(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('cannot read the unassigned property summary', async () => {
      await authed(app, caretaker).get(`/properties/${unassigned.id}/summary`).expect(404);
    });

    it('lists only units and buildings in the assigned property', async () => {
      const units = await authed(app, caretaker).get('/units').expect(200);
      expect(units.body.meta.total).toBe(1);
      expect(units.body.data[0].unitNumber).toBe('ASSIGNED-1');

      const buildings = await authed(app, caretaker).get('/buildings').expect(200);
      expect(buildings.body.meta.total).toBe(1);
      expect(buildings.body.data[0].name).toBe('Assigned Block');
    });

    it('cannot widen its own scope by asking for another property', async () => {
      // Filtering by an unassigned property must not become a way around the
      // scope — it reads as not found, exactly like a direct fetch.
      await authed(app, caretaker).get(`/units?propertyId=${unassigned.id}`).expect(404);
      await authed(app, caretaker).get(`/buildings?propertyId=${unassigned.id}`).expect(404);
    });

    it('sees only assigned units in the vacant feed', async () => {
      const response = await authed(app, caretaker).get('/units/vacant').expect(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].unitNumber).toBe('ASSIGNED-1');
    });

    it('can change a unit status inside its scope but not outside it', async () => {
      const mine = await authed(app, caretaker).get('/units').expect(200);
      await authed(app, caretaker)
        .patch(`/units/${mine.body.data[0].id}/status`)
        .send({ status: 'MAINTENANCE' })
        .expect(200);

      const theirs = await prisma.unit.findFirstOrThrow({
        where: { propertyId: unassigned.id },
      });
      await authed(app, caretaker)
        .patch(`/units/${theirs.id}/status`)
        .send({ status: 'MAINTENANCE' })
        .expect(404);
    });
  });

  it('shows an accountant exactly the two properties it is assigned', async () => {
    await createStaff('ACCOUNTANT', 'accountant@abc.test');
    await assign('accountant@abc.test', assigned.id);
    await assign('accountant@abc.test', unassigned.id);
    const accountant = await signIn(app, 'accountant@abc.test', STRONG_PASSWORD);

    const response = await authed(app, accountant).get('/properties').expect(200);
    expect(response.body.meta.total).toBe(2);
  });

  it('shows a scoped user with NO assignments nothing at all', async () => {
    // The failure mode this guards against: an empty id list being treated as
    // "no filter" rather than "no access".
    const caretaker = await createStaff('CARETAKER', 'newcaretaker@abc.test');

    const me = await authed(app, caretaker).get('/auth/me').expect(200);
    expect(me.body.scopedPropertyIds).toEqual([]);

    const properties = await authed(app, caretaker).get('/properties').expect(200);
    expect(properties.body.meta.total).toBe(0);

    const units = await authed(app, caretaker).get('/units').expect(200);
    expect(units.body.meta.total).toBe(0);

    const buildings = await authed(app, caretaker).get('/buildings').expect(200);
    expect(buildings.body.meta.total).toBe(0);

    await authed(app, caretaker).get(`/properties/${assigned.id}`).expect(404);
  });
});

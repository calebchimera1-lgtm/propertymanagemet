import type { NestExpressApplication } from '@nestjs/platform-express';
import type { RoleName } from '@pm/types';
import * as argon2 from 'argon2';
import type { PrismaService } from '@/prisma/prisma.service';
import { STRONG_PASSWORD, type SignedIn, authed, registerOrganization, signIn } from './helpers/api-client';
import {
  createBuilding,
  createLease,
  createProperty,
  createTenant,
  createUnit,
} from './helpers/portfolio';
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

  /** A month the seeded leases (2026-01-01 → 2026-12-31) cover. */
  const PERIOD = '2026-06';

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

    const assignedUnit = await createUnit(app, owner, assigned.id, { unitNumber: 'ASSIGNED-1' });
    const unassignedUnit = await createUnit(app, owner, unassigned.id, {
      unitNumber: 'UNASSIGNED-1',
    });
    await createBuilding(app, owner, assigned.id, { name: 'Assigned Block' });
    await createBuilding(app, owner, unassigned.id, { name: 'Unassigned Block' });

    // One tenant leasing in each property, so scope can be told apart.
    const assignedTenant = await createTenant(app, owner, { fullName: 'Assigned Tenant' });
    const unassignedTenant = await createTenant(app, owner, { fullName: 'Unassigned Tenant' });
    await createLease(app, owner, { tenantId: assignedTenant.id, unitId: assignedUnit.id });
    await createLease(app, owner, { tenantId: unassignedTenant.id, unitId: unassignedUnit.id });

    // A spare vacant unit in each property: the vacant-feed and unit-status
    // assertions need a unit that is genuinely available.
    await createUnit(app, owner, assigned.id, { unitNumber: 'ASSIGNED-SPARE' });
    await createUnit(app, owner, unassigned.id, { unitNumber: 'UNASSIGNED-SPARE' });

    // Money in both properties, so a scoped user seeing "some" rather than
    // "none" is a real result and not an empty database.
    await authed(app, owner).post('/rent/generate').send({ period: PERIOD }).expect(201);
    const roll = await authed(app, owner).get('/rent').query({ period: PERIOD, limit: 100 }).expect(200);
    for (const record of roll.body.data as { id: string; propertyId: string }[]) {
      await authed(app, owner)
        .post('/payments')
        .send({
          rentRecordId: record.id,
          amount: '1000.00',
          paymentDate: '2026-06-05',
          paymentMethod: 'CASH',
          reference: `SCOPE-${record.id.slice(-6)}`,
        })
        .expect(201);
    }
    for (const property of [assigned, unassigned]) {
      await authed(app, owner)
        .post('/maintenance')
        .send({
          propertyId: property.id,
          title: `${property.name} broken tap`,
          description: 'Dripping.',
          priority: 'HIGH',
        })
        .expect(201);
    }
    for (const property of [assigned, unassigned]) {
      await authed(app, owner)
        .post('/expenses')
        .send({
          propertyId: property.id,
          category: 'SECURITY',
          description: `${property.name} guard`,
          amount: '4000.00',
          expenseDate: '2026-06-02',
        })
        .expect(201);
    }
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
      expect(units.body.meta.total).toBe(2); // the leased unit and the spare
      expect(units.body.data.map((unit: { unitNumber: string }) => unit.unitNumber).sort()).toEqual([
        'ASSIGNED-1',
        'ASSIGNED-SPARE',
      ]);

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

    it('sees only tenants leasing in the assigned property', async () => {
      // A tenant belongs to the organization, not a property — scope reaches
      // them through their leases.
      const response = await authed(app, caretaker).get('/tenants').expect(200);
      expect(response.body.meta.total).toBe(1);
      expect(response.body.data[0].fullName).toBe('Assigned Tenant');
    });

    it('sees only leases in the assigned property', async () => {
      const response = await authed(app, caretaker).get('/leases').expect(200);
      expect(response.body.meta.total).toBe(1);
      expect(response.body.data[0].unit.unitNumber).toBe('ASSIGNED-1');

      const expiring = await authed(app, caretaker).get('/leases/expiring?days=365').expect(200);
      expect(expiring.body.data).toHaveLength(1);
    });

    it('gets 404 for a tenant and a lease outside its scope', async () => {
      const foreignTenant = await prisma.tenant.findFirstOrThrow({
        where: { fullName: 'Unassigned Tenant' },
      });
      const foreignLease = await prisma.lease.findFirstOrThrow({
        where: { propertyId: unassigned.id },
      });

      await authed(app, caretaker).get(`/tenants/${foreignTenant.id}`).expect(404);
      await authed(app, caretaker).get(`/tenants/${foreignTenant.id}/profile`).expect(404);
      await authed(app, caretaker).get(`/leases/${foreignLease.id}`).expect(404);
    });

    it('sees only assigned units in the vacant feed', async () => {
      const response = await authed(app, caretaker).get('/units/vacant').expect(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].unitNumber).toBe('ASSIGNED-SPARE');
    });

    it('sees only expenses booked to the assigned property', async () => {
      const response = await authed(app, caretaker).get('/expenses').expect(200);
      expect(response.body.meta.total).toBe(1);
      expect(response.body.data[0].property.name).toBe('Assigned Estate');
      expect(response.body.totalAmount).toBe('4000.00');
    });

    it('cannot book an expense to a property it is not assigned to', async () => {
      await authed(app, caretaker)
        .post('/expenses')
        .send({
          propertyId: unassigned.id,
          category: 'CLEANING',
          description: 'Out of scope',
          amount: '500.00',
          expenseDate: '2026-06-09',
        })
        .expect(404);
    });

    it('sees only maintenance on the assigned property', async () => {
      const response = await authed(app, caretaker).get('/maintenance').expect(200);
      expect(response.body.meta.total).toBe(1);
      expect(response.body.data[0].property.name).toBe('Assigned Estate');
    });

    it('cannot raise a job on a property it is not assigned to', async () => {
      await authed(app, caretaker)
        .post('/maintenance')
        .send({
          propertyId: unassigned.id,
          title: 'Out of scope',
          description: 'Should be refused.',
        })
        .expect(404);
    });

    it('cannot reach a request outside its scope, or widen scope with a filter', async () => {
      const foreign = await prisma.maintenanceRequest.findFirstOrThrow({
        where: { propertyId: unassigned.id },
      });
      await authed(app, caretaker).get(`/maintenance/${foreign.id}`).expect(404);
      await authed(app, caretaker).get(`/maintenance?propertyId=${unassigned.id}`).expect(404);
    });

    it('counts only its own scope on the maintenance board', async () => {
      // A summary that quietly included another estate's jobs would be a leak
      // in the shape of a number.
      const summary = await authed(app, caretaker).get('/maintenance/summary').expect(200);
      expect(summary.body.counts.PENDING).toBe(1);
    });

    it('cannot see rent or payments at all, whatever its scope', async () => {
      // Scope narrows what a role can reach; it never grants a permission the
      // role does not hold.
      await authed(app, caretaker).get('/rent').expect(403);
      await authed(app, caretaker).get('/payments').expect(403);
      await authed(app, caretaker).get('/receipts').expect(403);
    });

    it('cannot manage staff or read the audit trail', async () => {
      await authed(app, caretaker).get('/staff').expect(403);
      await authed(app, caretaker).get('/audit-logs').expect(403);
    });

    it('can change a unit status inside its scope but not outside it', async () => {
      const mine = await prisma.unit.findFirstOrThrow({
        where: { propertyId: assigned.id, unitNumber: 'ASSIGNED-SPARE' },
      });
      await authed(app, caretaker)
        .patch(`/units/${mine.id}/status`)
        .send({ status: 'MAINTENANCE' })
        .expect(200);

      const theirs = await prisma.unit.findFirstOrThrow({
        where: { propertyId: unassigned.id, unitNumber: 'UNASSIGNED-SPARE' },
      });
      await authed(app, caretaker)
        .patch(`/units/${theirs.id}/status`)
        .send({ status: 'MAINTENANCE' })
        .expect(404);
    });
  });

  describe('an accountant assigned to one property', () => {
    let accountant: SignedIn;

    beforeEach(async () => {
      await createStaff('ACCOUNTANT', 'scoped.accountant@abc.test');
      await assign('scoped.accountant@abc.test', assigned.id);
      accountant = await signIn(app, 'scoped.accountant@abc.test', STRONG_PASSWORD);
    });

    it('sees rent, payments, receipts and expenses for the assigned property only', async () => {
      const rent = await authed(app, accountant).get('/rent').query({ period: PERIOD }).expect(200);
      expect(rent.body.meta.total).toBe(1);
      expect(rent.body.data[0].property.name).toBe('Assigned Estate');

      const payments = await authed(app, accountant).get('/payments').expect(200);
      expect(payments.body.meta.total).toBe(1);
      expect(payments.body.totalAmount).toBe('1000.00');

      const receipts = await authed(app, accountant).get('/receipts').expect(200);
      expect(receipts.body.meta.total).toBe(1);

      const expenses = await authed(app, accountant).get('/expenses').expect(200);
      expect(expenses.body.meta.total).toBe(1);
    });

    it('reports summaries covering only the assigned property', async () => {
      // The dangerous failure for a summary is not a missing row, it is a
      // total that quietly includes a property the user cannot open.
      const summary = await authed(app, accountant)
        .get('/rent/summary')
        .query({ period: PERIOD })
        .expect(200);
      expect(summary.body.recordCount).toBe(1);
      expect(summary.body.totals.collected).toBe('1000.00');

      const expenses = await authed(app, accountant).get('/expenses/summary').expect(200);
      expect(expenses.body.total).toBe('4000.00');
      expect(expenses.body.count).toBe(1);
    });

    it('gets 404 for a charge, payment, receipt or expense outside its scope', async () => {
      const charge = await prisma.rentRecord.findFirstOrThrow({
        where: { propertyId: unassigned.id },
      });
      const payment = await prisma.payment.findFirstOrThrow({
        where: { propertyId: unassigned.id },
      });
      const receipt = await prisma.receipt.findFirstOrThrow({
        where: { propertyId: unassigned.id },
      });
      const expense = await prisma.expense.findFirstOrThrow({
        where: { propertyId: unassigned.id },
      });

      await authed(app, accountant).get(`/rent/${charge.id}`).expect(404);
      await authed(app, accountant).get(`/payments/${payment.id}`).expect(404);
      await authed(app, accountant).get(`/receipts/${receipt.id}`).expect(404);
      await authed(app, accountant).get(`/expenses/${expense.id}`).expect(404);
    });

    it('cannot pay a charge outside its scope', async () => {
      const charge = await prisma.rentRecord.findFirstOrThrow({
        where: { propertyId: unassigned.id },
      });

      await authed(app, accountant)
        .post('/payments')
        .send({
          rentRecordId: charge.id,
          amount: '100.00',
          paymentDate: '2026-06-06',
          paymentMethod: 'CASH',
        })
        .expect(404);
    });

    it('cannot widen its scope through a filter', async () => {
      await authed(app, accountant).get(`/rent?propertyId=${unassigned.id}`).expect(404);
      await authed(app, accountant).get(`/payments?propertyId=${unassigned.id}`).expect(404);
      await authed(app, accountant).get(`/receipts?propertyId=${unassigned.id}`).expect(404);
      await authed(app, accountant).get(`/expenses?propertyId=${unassigned.id}`).expect(404);
    });

    it('generates rent only for the properties it can see', async () => {
      // A scoped user pressing "generate" must not create charges for — or
      // even report a count covering — a property they cannot open.
      const result = await authed(app, accountant)
        .post('/rent/generate')
        .send({ period: '2026-07' })
        .expect(201);

      expect(result.body.created).toBe(1);
      const created = await prisma.rentRecord.findMany({
        where: { periodStart: new Date('2026-07-01') },
        select: { propertyId: true },
      });
      expect(created.map((row) => row.propertyId)).toEqual([assigned.id]);
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

    const tenants = await authed(app, caretaker).get('/tenants').expect(200);
    expect(tenants.body.meta.total).toBe(0);

    const leases = await authed(app, caretaker).get('/leases').expect(200);
    expect(leases.body.meta.total).toBe(0);

    const expenses = await authed(app, caretaker).get('/expenses').expect(200);
    expect(expenses.body.meta.total).toBe(0);
    expect(expenses.body.totalAmount).toBe('0.00');

    const maintenance = await authed(app, caretaker).get('/maintenance').expect(200);
    expect(maintenance.body.meta.total).toBe(0);
    expect(maintenance.body.openCount).toBe(0);

    await authed(app, caretaker).get(`/properties/${assigned.id}`).expect(404);
  });
});

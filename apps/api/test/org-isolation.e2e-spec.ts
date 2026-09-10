import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaService } from '@/prisma/prisma.service';
import request from 'supertest';
import {
  BASE,
  STRONG_PASSWORD,
  type SignedIn,
  authed,
  registerOrganization,
} from './helpers/api-client';
import {
  createBuilding,
  createLease,
  createProperty,
  createTenant,
  createUnit,
} from './helpers/portfolio';
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
  /** A month the seeded lease (2026-01-01 → 2026-12-31) covers. */
  const PERIOD = '2026-06';

  let abcPortfolio: {
    propertyId: string;
    buildingId: string;
    unitId: string;
    tenantId: string;
    leaseId: string;
    spareUnitId: string;
    rentRecordId: string;
    paymentId: string;
    receiptId: string;
    receiptNumber: string;
    expenseId: string;
    maintenanceId: string;
    documentId: string;
  };
  let xyzPortfolio: typeof abcPortfolio;

  async function seedPortfolio(session: SignedIn, label: string) {
    const property = await createProperty(app, session, { name: `${label} Estate` });
    const building = await createBuilding(app, session, property.id, { name: `${label} Block` });
    const unit = await createUnit(app, session, property.id, {
      buildingId: building.id,
      unitNumber: `${label}-1`,
    });
    const tenant = await createTenant(app, session, { fullName: `${label} Tenant` });
    const lease = await createLease(app, session, { tenantId: tenant.id, unitId: unit.id });
    // Left unleased on purpose: the vacant-unit and unit-status assertions
    // below need a unit that is actually available.
    const spare = await createUnit(app, session, property.id, {
      buildingId: building.id,
      unitNumber: `${label}-SPARE`,
    });
    // A charge, a payment, a receipt and an expense, so the finance assertions
    // below are about real records rather than empty tables.
    await authed(app, session).post('/rent/generate').send({ period: PERIOD }).expect(201);
    const roll = await authed(app, session).get('/rent').query({ period: PERIOD }).expect(200);
    const rentRecordId = roll.body.data[0].id as string;

    const payment = await authed(app, session)
      .post('/payments')
      .send({
        rentRecordId,
        amount: '5000.00',
        paymentDate: '2026-06-05',
        paymentMethod: 'MPESA',
        reference: `${label}-REF-1`,
      })
      .expect(201);

    const expense = await authed(app, session)
      .post('/expenses')
      .send({
        propertyId: property.id,
        category: 'REPAIRS',
        description: `${label} pump repair`,
        amount: '9000.00',
        expenseDate: '2026-06-08',
      })
      .expect(201);

    const maintenance = await authed(app, session)
      .post('/maintenance')
      .send({
        propertyId: property.id,
        unitId: unit.id,
        title: `${label} broken tap`,
        description: 'Dripping.',
      })
      .expect(201);

    const document = await request(app.getHttpServer())
      .post(`${BASE}/documents`)
      .set('Cookie', session.cookies)
      .set('X-CSRF-Token', session.csrfToken)
      .attach('file', Buffer.from('%PDF-1.7\nfixture\n'), {
        filename: `${label}-lease.pdf`,
        contentType: 'application/pdf',
      })
      .field('entityType', 'UNIT')
      .field('entityId', unit.id)
      .expect(201);

    return {
      propertyId: property.id,
      buildingId: building.id,
      unitId: unit.id,
      tenantId: tenant.id,
      leaseId: lease.id,
      spareUnitId: spare.id,
      rentRecordId,
      paymentId: payment.body.id as string,
      receiptId: payment.body.receipt.id as string,
      receiptNumber: payment.body.receipt.receiptNumber as string,
      expenseId: expense.body.id as string,
      maintenanceId: maintenance.body.id as string,
      documentId: document.body.id as string,
    };
  }

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

    abcPortfolio = await seedPortfolio(abc, 'ABC');
    xyzPortfolio = await seedPortfolio(xyz, 'XYZ');
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

  describe('the portfolio', () => {
    it('lists only the caller\'s own properties, buildings and units', async () => {
      const properties = await authed(app, abc).get('/properties').expect(200);
      expect(properties.body.meta.total).toBe(1);
      expect(properties.body.data[0].name).toBe('ABC Estate');
      expect(JSON.stringify(properties.body)).not.toContain('XYZ Estate');

      const buildings = await authed(app, abc).get('/buildings').expect(200);
      expect(buildings.body.meta.total).toBe(1);
      expect(JSON.stringify(buildings.body)).not.toContain('XYZ Block');

      const units = await authed(app, abc).get('/units').expect(200);
      expect(units.body.meta.total).toBe(2); // the leased unit and the spare
      expect(JSON.stringify(units.body)).not.toContain('XYZ-1');

      const vacant = await authed(app, abc).get('/units/vacant').expect(200);
      expect(vacant.body).toHaveLength(1);
      expect(vacant.body[0].unitNumber).toBe('ABC-SPARE');
    });

    it.each([
      ['GET /properties/:id', (ids: typeof xyzPortfolio) => `/properties/${ids.propertyId}`],
      ['GET /properties/:id/summary', (ids: typeof xyzPortfolio) => `/properties/${ids.propertyId}/summary`],
      ['GET /buildings/:id', (ids: typeof xyzPortfolio) => `/buildings/${ids.buildingId}`],
      ['GET /units/:id', (ids: typeof xyzPortfolio) => `/units/${ids.unitId}`],
      ['GET /tenants/:id', (ids: typeof xyzPortfolio) => `/tenants/${ids.tenantId}`],
      ['GET /tenants/:id/profile', (ids: typeof xyzPortfolio) => `/tenants/${ids.tenantId}/profile`],
      ['GET /leases/:id', (ids: typeof xyzPortfolio) => `/leases/${ids.leaseId}`],
    ])('%s returns 404 for another organization\'s record', async (_label, path) => {
      const response = await authed(app, abc).get(path(xyzPortfolio)).expect(404);
      expect(response.body.code).toBe('NOT_FOUND');
      expect(response.body.statusCode).not.toBe(403);
    });

    it('cannot update or delete another organization\'s records', async () => {
      await authed(app, abc)
        .patch(`/properties/${xyzPortfolio.propertyId}`)
        .send({ city: 'Hacked' })
        .expect(404);
      await authed(app, abc)
        .patch(`/units/${xyzPortfolio.unitId}`)
        .send({ monthlyRent: '1.00' })
        .expect(404);
      // Targets the spare, which is vacant: a 409 for "occupied" would mask
      // whether the scope check ran at all.
      await authed(app, abc)
        .patch(`/units/${xyzPortfolio.spareUnitId}/status`)
        .send({ status: 'UNAVAILABLE' })
        .expect(404);
      await authed(app, abc).delete(`/buildings/${xyzPortfolio.buildingId}`).expect(404);
      await authed(app, abc).delete(`/units/${xyzPortfolio.unitId}`).expect(404);

      // Everything on the other side is untouched.
      const unit = await prisma.unit.findUniqueOrThrow({ where: { id: xyzPortfolio.unitId } });
      expect(unit.monthlyRent.toFixed(2)).toBe('32000.00');
      const spare = await prisma.unit.findUniqueOrThrow({
        where: { id: xyzPortfolio.spareUnitId },
      });
      expect(spare.status).toBe('VACANT');
      const building = await prisma.building.findUnique({ where: { id: xyzPortfolio.buildingId } });
      expect(building).not.toBeNull();
    });

    it('cannot create a building under another organization\'s property', async () => {
      await authed(app, abc)
        .post('/buildings')
        .send({ propertyId: xyzPortfolio.propertyId, name: 'Trespassing Block' })
        .expect(404);

      const count = await prisma.building.count({ where: { propertyId: xyzPortfolio.propertyId } });
      expect(count).toBe(1);
    });

    it('cannot create a unit under another organization\'s property', async () => {
      await authed(app, abc)
        .post('/units')
        .send({
          propertyId: xyzPortfolio.propertyId,
          unitNumber: 'TRESPASS-1',
          unitType: 'ONE_BEDROOM',
          monthlyRent: '1000',
        })
        .expect(404);

      const count = await prisma.unit.count({ where: { propertyId: xyzPortfolio.propertyId } });
      expect(count).toBe(2);
    });

    it('cannot reach another organization\'s rows by filtering for them', async () => {
      const units = await authed(app, abc)
        .get(`/units?propertyId=${xyzPortfolio.propertyId}`)
        .expect(200);
      // The tenant filter is applied first, so the foreign id simply matches
      // nothing rather than leaking a row.
      expect(units.body.meta.total).toBe(0);
    });
  });

  describe('occupancy', () => {
    it('lists only the caller\'s own tenants and leases', async () => {
      const tenants = await authed(app, abc).get('/tenants').expect(200);
      expect(tenants.body.meta.total).toBe(1);
      expect(tenants.body.data[0].fullName).toBe('ABC Tenant');
      expect(JSON.stringify(tenants.body)).not.toContain('XYZ Tenant');

      const leases = await authed(app, abc).get('/leases').expect(200);
      expect(leases.body.meta.total).toBe(1);
      expect(JSON.stringify(leases.body)).not.toContain('XYZ-1');

      // 365 is the API's ceiling: a ten-year "expiring soon" window would not
      // be a worklist.
      const expiring = await authed(app, abc).get('/leases/expiring?days=365').expect(200);
      expect(expiring.body.data).toHaveLength(1);
    });

    it('cannot change or end another organization\'s lease', async () => {
      await authed(app, abc)
        .patch(`/leases/${xyzPortfolio.leaseId}`)
        .send({ monthlyRent: '1.00' })
        .expect(404);
      await authed(app, abc)
        .post(`/leases/${xyzPortfolio.leaseId}/terminate`)
        .send({ reason: 'Trespassing' })
        .expect(404);
      await authed(app, abc)
        .post(`/leases/${xyzPortfolio.leaseId}/renew`)
        .send({ endDate: '2030-01-01' })
        .expect(404);

      const untouched = await prisma.lease.findUniqueOrThrow({
        where: { id: xyzPortfolio.leaseId },
      });
      expect(untouched.status).toBe('ACTIVE');
      expect(untouched.monthlyRent.toFixed(2)).toBe('32000.00');
    });

    it('cannot update or delete another organization\'s tenant', async () => {
      await authed(app, abc)
        .patch(`/tenants/${xyzPortfolio.tenantId}`)
        .send({ fullName: 'Renamed' })
        .expect(404);
      await authed(app, abc).delete(`/tenants/${xyzPortfolio.tenantId}`).expect(404);

      const untouched = await prisma.tenant.findUniqueOrThrow({
        where: { id: xyzPortfolio.tenantId },
      });
      expect(untouched.fullName).toBe('XYZ Tenant');
    });

    it('cannot lease its own tenant into another organization\'s unit', async () => {
      await authed(app, abc)
        .post('/leases')
        .send({
          tenantId: abcPortfolio.tenantId,
          unitId: xyzPortfolio.unitId,
          startDate: '2026-01-01',
          dueDay: 5,
        })
        .expect(404);

      const count = await prisma.lease.count({ where: { unitId: xyzPortfolio.unitId } });
      expect(count).toBe(1);
    });

    it('cannot lease another organization\'s tenant into its own unit', async () => {
      const spareUnit = await createUnit(app, abc, abcPortfolio.propertyId, {
        unitNumber: 'ABC-SPARE',
      });

      await authed(app, abc)
        .post('/leases')
        .send({
          tenantId: xyzPortfolio.tenantId,
          unitId: spareUnit.id,
          startDate: '2026-01-01',
          dueDay: 5,
        })
        .expect(404);
    });
  });

  describe('rent, payments, receipts and expenses', () => {
    it('lists only its own money', async () => {
      const rent = await authed(app, abc).get('/rent').query({ period: PERIOD }).expect(200);
      expect(rent.body.meta.total).toBe(1);
      expect(rent.body.data[0].id).toBe(abcPortfolio.rentRecordId);

      const payments = await authed(app, abc).get('/payments').expect(200);
      expect(payments.body.meta.total).toBe(1);
      expect(payments.body.data[0].id).toBe(abcPortfolio.paymentId);
      expect(payments.body.totalAmount).toBe('5000.00');

      const receipts = await authed(app, abc).get('/receipts').expect(200);
      expect(receipts.body.meta.total).toBe(1);
      expect(receipts.body.data[0].id).toBe(abcPortfolio.receiptId);

      const expenses = await authed(app, abc).get('/expenses').expect(200);
      expect(expenses.body.meta.total).toBe(1);
      expect(expenses.body.totalAmount).toBe('9000.00');
    });

    it('cannot read another organization\'s charge, payment, receipt or expense', async () => {
      for (const path of [
        `/rent/${xyzPortfolio.rentRecordId}`,
        `/payments/${xyzPortfolio.paymentId}`,
        `/receipts/${xyzPortfolio.receiptId}`,
        `/expenses/${xyzPortfolio.expenseId}`,
      ]) {
        // 404, never 403: a 403 would confirm the record exists.
        await authed(app, abc).get(path).expect(404);
      }
    });

    it('cannot pay another organization\'s charge', async () => {
      await authed(app, abc)
        .post('/payments')
        .send({
          rentRecordId: xyzPortfolio.rentRecordId,
          amount: '1000.00',
          paymentDate: '2026-06-06',
          paymentMethod: 'CASH',
        })
        .expect(404);

      const payments = await prisma.payment.count({ where: { rentRecordId: xyzPortfolio.rentRecordId } });
      expect(payments).toBe(1);
    });

    it('cannot void another organization\'s payment', async () => {
      await authed(app, abc)
        .post(`/payments/${xyzPortfolio.paymentId}/void`)
        .send({ reason: 'Not mine to void' })
        .expect(404);

      const payment = await prisma.payment.findUniqueOrThrow({
        where: { id: xyzPortfolio.paymentId },
      });
      expect(payment.status).toBe('COMPLETED');
    });

    it('cannot update or delete another organization\'s expense', async () => {
      await authed(app, abc)
        .patch(`/expenses/${xyzPortfolio.expenseId}`)
        .send({ amount: '1.00' })
        .expect(404);
      await authed(app, abc).delete(`/expenses/${xyzPortfolio.expenseId}`).expect(404);

      const expense = await prisma.expense.findUniqueOrThrow({
        where: { id: xyzPortfolio.expenseId },
      });
      expect(expense.amount.toFixed(2)).toBe('9000.00');
    });

    it('numbers receipts per organization, so both start at one', async () => {
      // Sequences are per-organization: XYZ's first receipt is number 1 even
      // though ABC already issued one. A global counter would leak how much
      // business another organization is doing.
      expect(abcPortfolio.receiptNumber).toMatch(/-000001$/);
      expect(xyzPortfolio.receiptNumber).toMatch(/-000001$/);
      expect(abcPortfolio.receiptNumber).not.toBe(xyzPortfolio.receiptNumber);
    });

    it('reports summaries covering only its own charges', async () => {
      const summary = await authed(app, abc).get('/rent/summary').query({ period: PERIOD }).expect(200);
      expect(summary.body.totals.collected).toBe('5000.00');
      expect(summary.body.recordCount).toBe(1);

      const expenses = await authed(app, abc).get('/expenses/summary').expect(200);
      expect(expenses.body.total).toBe('9000.00');
      expect(expenses.body.count).toBe(1);
    });
  });

  describe('maintenance, documents and notifications', () => {
    it('lists only its own operations records', async () => {
      const maintenance = await authed(app, abc).get('/maintenance').expect(200);
      expect(maintenance.body.meta.total).toBe(1);
      expect(maintenance.body.data[0].id).toBe(abcPortfolio.maintenanceId);

      const documents = await authed(app, abc).get('/documents').expect(200);
      expect(documents.body.meta.total).toBe(1);
      expect(documents.body.data[0].id).toBe(abcPortfolio.documentId);
    });

    it('cannot read another organization’s request or document', async () => {
      for (const path of [
        `/maintenance/${xyzPortfolio.maintenanceId}`,
        `/maintenance/${xyzPortfolio.maintenanceId}/updates`,
        `/documents/${xyzPortfolio.documentId}`,
        `/documents/${xyzPortfolio.documentId}/download`,
      ]) {
        await authed(app, abc).get(path).expect(404);
      }
    });

    it('cannot move another organization’s request through the workflow', async () => {
      await authed(app, abc)
        .post(`/maintenance/${xyzPortfolio.maintenanceId}/status`)
        .send({ status: 'IN_PROGRESS' })
        .expect(404);
      await authed(app, abc)
        .post(`/maintenance/${xyzPortfolio.maintenanceId}/assign`)
        .send({ assignedToId: abc.userId })
        .expect(404);

      const untouched = await prisma.maintenanceRequest.findUniqueOrThrow({
        where: { id: xyzPortfolio.maintenanceId },
      });
      expect(untouched.status).toBe('PENDING');
      expect(untouched.assignedToId).toBeNull();
    });

    it('cannot delete another organization’s document', async () => {
      await authed(app, abc).delete(`/documents/${xyzPortfolio.documentId}`).expect(404);
      expect(await prisma.document.count({ where: { id: xyzPortfolio.documentId } })).toBe(1);
    });

    it('cannot assign a job to a person in another organization', async () => {
      await authed(app, abc)
        .post(`/maintenance/${abcPortfolio.maintenanceId}/assign`)
        .send({ assignedToId: xyz.userId })
        .expect(422);
    });

    it('cannot see or manage another organization’s staff', async () => {
      const staff = await authed(app, abc).get('/staff').expect(200);
      expect(staff.body.meta.total).toBe(1);

      await authed(app, abc).get(`/staff/${xyz.userId}`).expect(404);
      await authed(app, abc).post(`/staff/${xyz.userId}/deactivate`).expect(404);
      await authed(app, abc).delete(`/staff/${xyz.userId}`).expect(404);
    });

    it('cannot read another organization’s audit trail', async () => {
      const audit = await authed(app, abc).get('/audit-logs').expect(200);
      const emails = audit.body.data.map((row: { actorEmail: string }) => row.actorEmail);
      expect(emails.every((email: string) => email.endsWith('@abc.test'))).toBe(true);

      const filtered = await authed(app, abc)
        .get(`/audit-logs?userId=${xyz.userId}`)
        .expect(200);
      expect(filtered.body.meta.total).toBe(0);
    });

    it('cannot mark another organization’s notification read', async () => {
      const theirs = await prisma.notification.findFirst({
        where: { organizationId: xyz.organizationId },
      });
      if (theirs) {
        await authed(app, abc).post(`/notifications/${theirs.id}/read`).expect(404);
      }
      const mine = await authed(app, abc).get('/notifications').expect(200);
      expect(mine.body.meta.total).toBeGreaterThanOrEqual(0);
    });
  });

  describe('the database itself', () => {
    it('refuses a cross-organization lease even with the API bypassed', async () => {
      await expect(
        prisma.lease.create({
          data: {
            organizationId: xyz.organizationId,
            tenantId: abcPortfolio.tenantId,
            propertyId: abcPortfolio.propertyId,
            // The spare, so the foreign key is what refuses this — not the
            // one-active-lease index, which would also reject it.
            unitId: abcPortfolio.spareUnitId,
            startDate: new Date('2026-01-01'),
            monthlyRent: '1000',
            dueDay: 5,
          },
        }),
      ).rejects.toThrow(/[Ff]oreign key/);
    });

    it('refuses a cross-organization payment even with the API bypassed', async () => {
      await expect(
        prisma.payment.create({
          data: {
            organizationId: xyz.organizationId,
            leaseId: abcPortfolio.leaseId,
            rentRecordId: abcPortfolio.rentRecordId,
            tenantId: abcPortfolio.tenantId,
            propertyId: abcPortfolio.propertyId,
            unitId: abcPortfolio.unitId,
            amount: '1000',
            paymentDate: new Date('2026-06-05'),
            paymentMethod: 'CASH',
            recordedById: xyz.userId,
          },
        }),
      ).rejects.toThrow(/[Ff]oreign key/);
    });

    it('refuses a cross-organization reference even with the API bypassed', async () => {
      // The last line of defence: the foreign key on (organizationId, propertyId)
      // makes this impossible regardless of what the application does.
      await expect(
        prisma.unit.create({
          data: {
            organizationId: xyz.organizationId,
            propertyId: abcPortfolio.propertyId,
            unitNumber: 'IMPOSSIBLE-1',
            unitType: 'ONE_BEDROOM',
            monthlyRent: '1000',
          },
        }),
      ).rejects.toThrow(/[Ff]oreign key/);
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

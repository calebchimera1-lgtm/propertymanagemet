import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaService } from '@/prisma/prisma.service';
import { STRONG_PASSWORD, type SignedIn, authed, registerOrganization } from './helpers/api-client';
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
  let abcPortfolio: {
    propertyId: string;
    buildingId: string;
    unitId: string;
    tenantId: string;
    leaseId: string;
    spareUnitId: string;
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
    return {
      propertyId: property.id,
      buildingId: building.id,
      unitId: unit.id,
      tenantId: tenant.id,
      leaseId: lease.id,
      spareUnitId: spare.id,
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

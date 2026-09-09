import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaService } from '@/prisma/prisma.service';
import { STRONG_PASSWORD, type SignedIn, authed, registerOrganization } from './helpers/api-client';
import { createBuilding, createProperty, createUnit } from './helpers/portfolio';
import { createTestApp, resetDatabase } from './helpers/test-app';

describe('Portfolio (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: SignedIn;

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

  describe('properties', () => {
    it('creates, reads, updates and lists a property', async () => {
      const created = await createProperty(app, owner, { name: 'Sunrise Estate' });
      expect(created.buildingCount).toBe(0);
      expect(created.unitCount).toBe(0);

      const fetched = await authed(app, owner).get(`/properties/${created.id}`).expect(200);
      expect(fetched.body.name).toBe('Sunrise Estate');

      await authed(app, owner)
        .patch(`/properties/${created.id}`)
        .send({ city: 'Mombasa' })
        .expect(200);

      const list = await authed(app, owner).get('/properties').expect(200);
      expect(list.body.meta.total).toBe(1);
      expect(list.body.data[0].city).toBe('Mombasa');
    });

    it('refuses a duplicate name with a field-level error', async () => {
      await createProperty(app, owner, { name: 'Sunrise Estate' });

      const response = await authed(app, owner)
        .post('/properties')
        .send({ name: 'Sunrise Estate', propertyType: 'APARTMENT' })
        .expect(409);

      expect(response.body.code).toBe('PROPERTY_NAME_TAKEN');
      expect(response.body.details[0].field).toBe('name');
    });

    it('rejects an unknown property type rather than storing it', async () => {
      await authed(app, owner)
        .post('/properties')
        .send({ name: 'Odd Estate', propertyType: 'CASTLE' })
        .expect(400);
    });

    it('excludes archived properties from the default list but keeps them findable', async () => {
      const property = await createProperty(app, owner, { name: 'Old Estate' });
      await authed(app, owner).post(`/properties/${property.id}/archive`).expect(201);

      const defaultList = await authed(app, owner).get('/properties').expect(200);
      expect(defaultList.body.meta.total).toBe(0);

      const archivedList = await authed(app, owner)
        .get('/properties?status=ARCHIVED')
        .expect(200);
      expect(archivedList.body.meta.total).toBe(1);

      // Archiving is reversible, which is the whole point of preferring it.
      await authed(app, owner)
        .patch(`/properties/${property.id}`)
        .send({ status: 'ACTIVE' })
        .expect(200);
      const restored = await authed(app, owner).get('/properties').expect(200);
      expect(restored.body.meta.total).toBe(1);
    });

    it('refuses to delete a property that still has units, and says why', async () => {
      const property = await createProperty(app, owner);
      await createUnit(app, owner, property.id);

      const response = await authed(app, owner).delete(`/properties/${property.id}`).expect(409);
      expect(response.body.code).toBe('PROPERTY_NOT_EMPTY');
      expect(response.body.message).toMatch(/archive it instead/i);

      // The property is still there. A refused delete must not half-delete.
      await authed(app, owner).get(`/properties/${property.id}`).expect(200);
    });

    it('deletes an empty property', async () => {
      const property = await createProperty(app, owner);
      await authed(app, owner).delete(`/properties/${property.id}`).expect(204);
      await authed(app, owner).get(`/properties/${property.id}`).expect(404);
    });

    it('summarises unit counts, occupancy and potential rent', async () => {
      const property = await createProperty(app, owner);
      await createUnit(app, owner, property.id, { monthlyRent: '30000.00' });
      await createUnit(app, owner, property.id, { monthlyRent: '45000.50' });

      const response = await authed(app, owner)
        .get(`/properties/${property.id}/summary`)
        .expect(200);

      expect(response.body.units.total).toBe(2);
      expect(response.body.units.vacant).toBe(2);
      expect(response.body.occupancyRate).toBe(0);
      // Decimal addition, as a fixed-scale string — not 75000.5 as a float.
      expect(response.body.potentialMonthlyRent).toBe('75000.50');
    });

    it('reports an occupancy rate of 0 rather than dividing by zero', async () => {
      const property = await createProperty(app, owner);
      const response = await authed(app, owner)
        .get(`/properties/${property.id}/summary`)
        .expect(200);

      expect(response.body.units.total).toBe(0);
      expect(response.body.occupancyRate).toBe(0);
      expect(response.body.potentialMonthlyRent).toBe('0.00');
    });
  });

  describe('buildings', () => {
    it('creates a building inside a property', async () => {
      const property = await createProperty(app, owner);
      const building = await createBuilding(app, owner, property.id, { name: 'Block A' });

      expect(building.propertyId).toBe(property.id);

      const list = await authed(app, owner)
        .get(`/buildings?propertyId=${property.id}`)
        .expect(200);
      expect(list.body.meta.total).toBe(1);
    });

    it('refuses two buildings with the same name in one property, but allows it across properties', async () => {
      const first = await createProperty(app, owner, { name: 'First Estate' });
      const second = await createProperty(app, owner, { name: 'Second Estate' });

      await createBuilding(app, owner, first.id, { name: 'Block A' });

      const clash = await authed(app, owner)
        .post('/buildings')
        .send({ propertyId: first.id, name: 'Block A' })
        .expect(409);
      expect(clash.body.code).toBe('BUILDING_NAME_TAKEN');

      // "Block A" in a different estate is a different building.
      await createBuilding(app, owner, second.id, { name: 'Block A' });
    });

    it('detaches units to the property when a building is deleted, rather than deleting them', async () => {
      const property = await createProperty(app, owner);
      const building = await createBuilding(app, owner, property.id);
      const unit = await createUnit(app, owner, property.id, { buildingId: building.id });

      const response = await authed(app, owner).delete(`/buildings/${building.id}`).expect(200);
      expect(response.body.detachedUnits).toBe(1);

      // The unit survives with its rent intact and now hangs off the property.
      const survivor = await authed(app, owner).get(`/units/${unit.id}`).expect(200);
      expect(survivor.body.buildingId).toBeNull();
      expect(survivor.body.monthlyRent).toBe('32000.00');
    });

    it('will not move a building between properties', async () => {
      const first = await createProperty(app, owner, { name: 'First Estate' });
      const second = await createProperty(app, owner, { name: 'Second Estate' });
      const building = await createBuilding(app, owner, first.id);

      // The field is not accepted at all: forbidNonWhitelisted rejects it.
      await authed(app, owner)
        .patch(`/buildings/${building.id}`)
        .send({ propertyId: second.id })
        .expect(400);

      const unchanged = await authed(app, owner).get(`/buildings/${building.id}`).expect(200);
      expect(unchanged.body.propertyId).toBe(first.id);
    });
  });

  describe('units', () => {
    it('returns money as a fixed-scale string, never a number', async () => {
      const property = await createProperty(app, owner);
      const unit = await createUnit(app, owner, property.id, {
        monthlyRent: '32000',
        securityDeposit: '1500.5',
      });

      // "32000" in, "32000.00" out: the scale is part of the contract.
      expect(unit.monthlyRent).toBe('32000.00');
      expect(unit.securityDeposit).toBe('1500.50');
      expect(typeof unit.monthlyRent).toBe('string');
    });

    it('rejects a rent that is not a valid amount', async () => {
      const property = await createProperty(app, owner);

      for (const monthlyRent of ['abc', '-100', '1.234', '']) {
        await authed(app, owner)
          .post('/units')
          .send({ propertyId: property.id, unitNumber: 'A1', unitType: 'ONE_BEDROOM', monthlyRent })
          .expect(400);
      }
    });

    it('refuses a duplicate unit number in the same building', async () => {
      const property = await createProperty(app, owner);
      const building = await createBuilding(app, owner, property.id);

      await createUnit(app, owner, property.id, { buildingId: building.id, unitNumber: 'A1' });

      const response = await authed(app, owner)
        .post('/units')
        .send({
          propertyId: property.id,
          buildingId: building.id,
          unitNumber: 'A1',
          unitType: 'ONE_BEDROOM',
          monthlyRent: '10000',
        })
        .expect(409);

      expect(response.body.code).toBe('UNIT_NUMBER_TAKEN');
    });

    it('refuses a duplicate unit number among units with no building', async () => {
      const property = await createProperty(app, owner);
      await createUnit(app, owner, property.id, { unitNumber: 'S1' });

      // A plain composite unique index would allow this, because Postgres
      // treats NULL buildingIds as distinct. A partial index does not.
      const response = await authed(app, owner)
        .post('/units')
        .send({
          propertyId: property.id,
          unitNumber: 'S1',
          unitType: 'SHOP',
          monthlyRent: '10000',
        })
        .expect(409);

      expect(response.body.code).toBe('UNIT_NUMBER_TAKEN');
    });

    it('refuses a building that belongs to a different property', async () => {
      const first = await createProperty(app, owner, { name: 'First Estate' });
      const second = await createProperty(app, owner, { name: 'Second Estate' });
      const buildingInSecond = await createBuilding(app, owner, second.id);

      const response = await authed(app, owner)
        .post('/units')
        .send({
          propertyId: first.id,
          buildingId: buildingInSecond.id,
          unitNumber: 'A1',
          unitType: 'ONE_BEDROOM',
          monthlyRent: '10000',
        })
        .expect(422);

      expect(response.body.details[0].field).toBe('buildingId');
    });

    it('filters by status, type and rent range', async () => {
      const property = await createProperty(app, owner);
      await createUnit(app, owner, property.id, { unitType: 'BEDSITTER', monthlyRent: '15000' });
      await createUnit(app, owner, property.id, { unitType: 'TWO_BEDROOM', monthlyRent: '50000' });
      await createUnit(app, owner, property.id, { unitType: 'SHOP', monthlyRent: '90000' });

      const cheap = await authed(app, owner).get('/units?maxRent=20000').expect(200);
      expect(cheap.body.meta.total).toBe(1);

      const midRange = await authed(app, owner)
        .get('/units?minRent=20000&maxRent=60000')
        .expect(200);
      expect(midRange.body.meta.total).toBe(1);
      expect(midRange.body.data[0].monthlyRent).toBe('50000.00');

      const shops = await authed(app, owner).get('/units?unitType=SHOP').expect(200);
      expect(shops.body.meta.total).toBe(1);

      const vacant = await authed(app, owner).get('/units?status=VACANT').expect(200);
      expect(vacant.body.meta.total).toBe(3);
    });

    it('sorts and pages on the server', async () => {
      const property = await createProperty(app, owner);
      for (const rent of ['10000', '30000', '20000']) {
        await createUnit(app, owner, property.id, { monthlyRent: rent });
      }

      const page = await authed(app, owner)
        .get('/units?sortBy=monthlyRent&sortOrder=asc&limit=2&page=1')
        .expect(200);

      expect(page.body.data).toHaveLength(2);
      expect(page.body.data.map((u: { monthlyRent: string }) => u.monthlyRent)).toEqual([
        '10000.00',
        '20000.00',
      ]);
      expect(page.body.meta.totalPages).toBe(2);
    });

    it('rejects an unsortable field instead of ignoring it', async () => {
      // An allow-list, not a pass-through: sortBy goes into a query, so an
      // arbitrary column name is not something to shrug at.
      await authed(app, owner).get('/units?sortBy=passwordHash').expect(400);
    });

    it('allows manual statuses but not OCCUPIED', async () => {
      const property = await createProperty(app, owner);
      const unit = await createUnit(app, owner, property.id);

      const maintenance = await authed(app, owner)
        .patch(`/units/${unit.id}/status`)
        .send({ status: 'MAINTENANCE', reason: 'Roof repair' })
        .expect(200);
      expect(maintenance.body.status).toBe('MAINTENANCE');

      // OCCUPIED is derived from a lease, from Phase 3 onward.
      await authed(app, owner)
        .patch(`/units/${unit.id}/status`)
        .send({ status: 'OCCUPIED' })
        .expect(400);
    });

    it('lists vacant units for assignment forms', async () => {
      const property = await createProperty(app, owner);
      const vacant = await createUnit(app, owner, property.id);
      const other = await createUnit(app, owner, property.id);
      await authed(app, owner)
        .patch(`/units/${other.id}/status`)
        .send({ status: 'UNAVAILABLE' })
        .expect(200);

      const response = await authed(app, owner).get('/units/vacant').expect(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe(vacant.id);
    });
  });

  describe('audit trail', () => {
    it('records every portfolio mutation', async () => {
      const property = await createProperty(app, owner);
      const building = await createBuilding(app, owner, property.id);
      const unit = await createUnit(app, owner, property.id);
      await authed(app, owner).patch(`/units/${unit.id}`).send({ bedrooms: 2 }).expect(200);
      await authed(app, owner).delete(`/buildings/${building.id}`).expect(200);

      const actions = (
        await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' }, select: { action: true } })
      ).map((log) => log.action);

      expect(actions).toEqual(
        expect.arrayContaining([
          'PROPERTY_CREATED',
          'BUILDING_CREATED',
          'UNIT_CREATED',
          'UNIT_UPDATED',
          'BUILDING_DELETED',
        ]),
      );
    });
  });
});

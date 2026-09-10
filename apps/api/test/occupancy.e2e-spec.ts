import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '@/prisma/prisma.service';
import {
  BASE,
  STRONG_PASSWORD,
  type SignedIn,
  authed,
  registerOrganization,
} from './helpers/api-client';
import { createLease, createProperty, createTenant, createUnit } from './helpers/portfolio';
import { createTestApp, resetDatabase } from './helpers/test-app';

describe('Occupancy (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: SignedIn;
  let propertyId: string;

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
    const property = await createProperty(app, owner, { name: 'Sunrise Estate' });
    propertyId = property.id;
  });

  describe('tenants', () => {
    it('creates, reads and updates a tenant', async () => {
      const tenant = await createTenant(app, owner, { fullName: 'Grace Wanjiku' });

      const fetched = await authed(app, owner).get(`/tenants/${tenant.id}`).expect(200);
      expect(fetched.body.fullName).toBe('Grace Wanjiku');
      expect(fetched.body.isActive).toBe(true);

      await authed(app, owner)
        .patch(`/tenants/${tenant.id}`)
        .send({ occupation: 'Teacher' })
        .expect(200);

      const list = await authed(app, owner).get('/tenants').expect(200);
      expect(list.body.meta.total).toBe(1);
      expect(list.body.data[0].occupation).toBe('Teacher');
      // A tenant with no lease reports null rather than a fabricated one.
      expect(list.body.data[0].currentLease).toBeNull();
    });

    it('refuses a duplicate ID number with a field-level error', async () => {
      await createTenant(app, owner, { nationalId: '12345678' });

      const response = await authed(app, owner)
        .post('/tenants')
        .send({ fullName: 'Impostor', phone: '+254700000000', nationalId: '12345678' })
        .expect(409);

      expect(response.body.code).toBe('TENANT_ID_TAKEN');
      expect(response.body.details[0].field).toBe('nationalId');
    });

    it('allows any number of tenants with no ID on file', async () => {
      // The partial unique index must not treat two absent IDs as a clash.
      await createTenant(app, owner);
      await createTenant(app, owner);
      const list = await authed(app, owner).get('/tenants').expect(200);
      expect(list.body.meta.total).toBe(2);
    });

    it('rejects a malformed phone number', async () => {
      await authed(app, owner)
        .post('/tenants')
        .send({ fullName: 'Bad Phone', phone: 'not-a-phone' })
        .expect(400);
    });

    it('filters by whether the tenant is housed', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const housed = await createTenant(app, owner, { fullName: 'Housed Person' });
      await createTenant(app, owner, { fullName: 'Unhoused Person' });
      await createLease(app, owner, { tenantId: housed.id, unitId: unit.id });

      const withLease = await authed(app, owner).get('/tenants?hasActiveLease=true').expect(200);
      expect(withLease.body.meta.total).toBe(1);
      expect(withLease.body.data[0].fullName).toBe('Housed Person');

      const without = await authed(app, owner).get('/tenants?hasActiveLease=false').expect(200);
      expect(without.body.meta.total).toBe(1);
      expect(without.body.data[0].fullName).toBe('Unhoused Person');
    });

    it('refuses to delete a tenant with lease history, and says why', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);
      await createLease(app, owner, { tenantId: tenant.id, unitId: unit.id });

      const response = await authed(app, owner).delete(`/tenants/${tenant.id}`).expect(409);
      expect(response.body.code).toBe('TENANT_HAS_HISTORY');
      expect(response.body.message).toMatch(/deactivate/i);

      await authed(app, owner).get(`/tenants/${tenant.id}`).expect(200);
    });

    it('deletes a tenant who has no history', async () => {
      const tenant = await createTenant(app, owner);
      await authed(app, owner).delete(`/tenants/${tenant.id}`).expect(204);
      await authed(app, owner).get(`/tenants/${tenant.id}`).expect(404);
    });

    it('builds a 360 profile that names what is not built yet', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);
      await createLease(app, owner, { tenantId: tenant.id, unitId: unit.id });

      const response = await authed(app, owner).get(`/tenants/${tenant.id}/profile`).expect(200);

      expect(response.body.currentLease).not.toBeNull();
      expect(response.body.leaseHistory).toHaveLength(1);
      // Not an empty array or a zero balance, which would read as "nothing owed".
      expect(response.body.finances.available).toBe(false);
      expect(response.body.finances.reason).toMatch(/Phase 4/);
    });
  });

  describe('creating a lease', () => {
    it('occupies the unit in the same transaction', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);

      const before = await authed(app, owner).get(`/units/${unit.id}`).expect(200);
      expect(before.body.status).toBe('VACANT');

      const lease = await createLease(app, owner, { tenantId: tenant.id, unitId: unit.id });
      expect(lease.status).toBe('ACTIVE');

      const after = await authed(app, owner).get(`/units/${unit.id}`).expect(200);
      expect(after.body.status).toBe('OCCUPIED');
    });

    it('copies rent and deposit from the unit, and keeps them when the unit changes', async () => {
      const unit = await createUnit(app, owner, propertyId, {
        monthlyRent: '30000.00',
        securityDeposit: '30000.00',
      });
      const tenant = await createTenant(app, owner);
      const lease = await createLease(app, owner, { tenantId: tenant.id, unitId: unit.id });

      expect(lease.monthlyRent).toBe('30000.00');

      // Raising the unit's advertised rent must not rewrite what a sitting
      // tenant agreed to pay.
      await authed(app, owner).patch(`/units/${unit.id}`).send({ monthlyRent: '45000' }).expect(200);

      const unchanged = await authed(app, owner).get(`/leases/${lease.id}`).expect(200);
      expect(unchanged.body.monthlyRent).toBe('30000.00');
    });

    it('accepts an explicit rent that differs from the unit', async () => {
      const unit = await createUnit(app, owner, propertyId, { monthlyRent: '30000.00' });
      const tenant = await createTenant(app, owner);
      const lease = await createLease(app, owner, {
        tenantId: tenant.id,
        unitId: unit.id,
        monthlyRent: '28000',
      });

      expect(lease.monthlyRent).toBe('28000.00');
    });

    it('refuses a unit that is already occupied', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const first = await createTenant(app, owner);
      const second = await createTenant(app, owner);
      await createLease(app, owner, { tenantId: first.id, unitId: unit.id });

      const response = await authed(app, owner)
        .post('/leases')
        .send({ tenantId: second.id, unitId: unit.id, startDate: '2026-01-01', dueDay: 5 })
        .expect(409);

      expect(response.body.code).toBe('UNIT_NOT_AVAILABLE');
      expect(response.body.message).toMatch(/already occupied/i);
    });

    it('refuses a unit that is out of service', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);
      await authed(app, owner)
        .patch(`/units/${unit.id}/status`)
        .send({ status: 'MAINTENANCE' })
        .expect(200);

      const response = await authed(app, owner)
        .post('/leases')
        .send({ tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01', dueDay: 5 })
        .expect(409);
      expect(response.body.code).toBe('UNIT_NOT_AVAILABLE');
    });

    it('refuses a deactivated tenant', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);
      await authed(app, owner)
        .patch(`/tenants/${tenant.id}`)
        .send({ isActive: false })
        .expect(200);

      const response = await authed(app, owner)
        .post('/leases')
        .send({ tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01', dueDay: 5 })
        .expect(409);
      expect(response.body.code).toBe('TENANT_INACTIVE');
    });

    it('refuses an end date before the start date', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);

      const response = await authed(app, owner)
        .post('/leases')
        .send({
          tenantId: tenant.id,
          unitId: unit.id,
          startDate: '2026-06-01',
          endDate: '2026-01-01',
          dueDay: 5,
        })
        .expect(422);

      expect(response.body.details[0].field).toBe('endDate');
    });

    it('refuses a due day that does not exist in every month', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);

      // 30 would silently skip February.
      await authed(app, owner)
        .post('/leases')
        .send({ tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01', dueDay: 30 })
        .expect(400);
    });

    it('refuses more deposit than the lease requires', async () => {
      const unit = await createUnit(app, owner, propertyId, { securityDeposit: '30000.00' });
      const tenant = await createTenant(app, owner);

      const response = await authed(app, owner)
        .post('/leases')
        .send({
          tenantId: tenant.id,
          unitId: unit.id,
          startDate: '2026-01-01',
          dueDay: 5,
          depositPaid: '50000',
        })
        .expect(422);

      expect(response.body.details[0].field).toBe('depositPaid');
    });

    it('keeps an open-ended lease with no expiry countdown', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);

      const response = await authed(app, owner)
        .post('/leases')
        .send({ tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01', dueDay: 5 })
        .expect(201);

      expect(response.body.endDate).toBeNull();
      expect(response.body.daysUntilExpiry).toBeNull();
    });
  });

  describe('the one-active-lease invariant', () => {
    it('survives two simultaneous requests for the same unit', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const first = await createTenant(app, owner);
      const second = await createTenant(app, owner);

      const body = (tenantId: string) => ({
        tenantId,
        unitId: unit.id,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        dueDay: 5,
      });

      // Both requests pass the availability check before either commits. Only
      // the partial unique index can decide this one.
      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post(`${BASE}/leases`)
          .set('Cookie', owner.cookies)
          .set('X-CSRF-Token', owner.csrfToken)
          .send(body(first.id)),
        request(app.getHttpServer())
          .post(`${BASE}/leases`)
          .set('Cookie', owner.cookies)
          .set('X-CSRF-Token', owner.csrfToken)
          .send(body(second.id)),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);

      const loser = a.status === 409 ? a : b;
      expect(loser.body.code).toBe('UNIT_NOT_AVAILABLE');

      // Exactly one lease, and the unit is occupied exactly once.
      const activeLeases = await prisma.lease.count({
        where: { unitId: unit.id, status: 'ACTIVE' },
      });
      expect(activeLeases).toBe(1);

      const finalUnit = await prisma.unit.findUniqueOrThrow({ where: { id: unit.id } });
      expect(finalUnit.status).toBe('OCCUPIED');
    });

    it('lets a unit accumulate history once leases are closed', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const first = await createTenant(app, owner);
      const second = await createTenant(app, owner);

      const lease = await createLease(app, owner, { tenantId: first.id, unitId: unit.id });
      await authed(app, owner)
        .post(`/leases/${lease.id}/terminate`)
        .send({ reason: 'Relocating' })
        .expect(201);

      await createLease(app, owner, { tenantId: second.id, unitId: unit.id });

      const all = await prisma.lease.count({ where: { unitId: unit.id } });
      expect(all).toBe(2);
      const active = await prisma.lease.count({ where: { unitId: unit.id, status: 'ACTIVE' } });
      expect(active).toBe(1);
    });
  });

  describe('terminating a lease', () => {
    it('frees the unit and keeps the lease as a record', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);
      const lease = await createLease(app, owner, { tenantId: tenant.id, unitId: unit.id });

      const response = await authed(app, owner)
        .post(`/leases/${lease.id}/terminate`)
        .send({ reason: 'Tenant relocating' })
        .expect(201);

      expect(response.body.status).toBe('TERMINATED');
      expect(response.body.terminatedAt).not.toBeNull();
      expect(response.body.terminationReason).toBe('Tenant relocating');

      const freedUnit = await authed(app, owner).get(`/units/${unit.id}`).expect(200);
      expect(freedUnit.body.status).toBe('VACANT');

      // The lease is still readable — it is the record of who lived there.
      await authed(app, owner).get(`/leases/${lease.id}`).expect(200);
    });

    it('can leave the unit in maintenance instead of vacant', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);
      const lease = await createLease(app, owner, { tenantId: tenant.id, unitId: unit.id });

      await authed(app, owner)
        .post(`/leases/${lease.id}/terminate`)
        .send({ unitStatus: 'MAINTENANCE' })
        .expect(201);

      const freedUnit = await authed(app, owner).get(`/units/${unit.id}`).expect(200);
      expect(freedUnit.body.status).toBe('MAINTENANCE');
    });

    it('refuses to terminate twice', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);
      const lease = await createLease(app, owner, { tenantId: tenant.id, unitId: unit.id });

      await authed(app, owner).post(`/leases/${lease.id}/terminate`).send({}).expect(201);
      const response = await authed(app, owner)
        .post(`/leases/${lease.id}/terminate`)
        .send({})
        .expect(409);
      expect(response.body.code).toBe('LEASE_TERMINATED');
    });

    it('refuses to edit a terminated lease', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);
      const lease = await createLease(app, owner, { tenantId: tenant.id, unitId: unit.id });
      await authed(app, owner).post(`/leases/${lease.id}/terminate`).send({}).expect(201);

      await authed(app, owner)
        .patch(`/leases/${lease.id}`)
        .send({ monthlyRent: '1.00' })
        .expect(409);
    });
  });

  describe('renewing a lease', () => {
    it('extends the term and can review the rent', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);
      const lease = await createLease(app, owner, {
        tenantId: tenant.id,
        unitId: unit.id,
        endDate: '2026-12-31',
      });

      const response = await authed(app, owner)
        .post(`/leases/${lease.id}/renew`)
        .send({ endDate: '2027-12-31', monthlyRent: '35000' })
        .expect(201);

      expect(response.body.endDate).toContain('2027-12-31');
      expect(response.body.monthlyRent).toBe('35000.00');
      expect(response.body.status).toBe('ACTIVE');
    });

    it('refuses a renewal that does not extend the lease', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);
      const lease = await createLease(app, owner, {
        tenantId: tenant.id,
        unitId: unit.id,
        endDate: '2026-12-31',
      });

      const response = await authed(app, owner)
        .post(`/leases/${lease.id}/renew`)
        .send({ endDate: '2026-06-30' })
        .expect(422);

      expect(response.body.details[0].field).toBe('endDate');
    });

    it('renews an expired lease back to active', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);
      const lease = await createLease(app, owner, { tenantId: tenant.id, unitId: unit.id });

      // A tenant staying past the end date is the normal case.
      await prisma.lease.update({ where: { id: lease.id }, data: { status: 'EXPIRED' } });

      const response = await authed(app, owner)
        .post(`/leases/${lease.id}/renew`)
        .send({ endDate: '2028-12-31' })
        .expect(201);

      expect(response.body.status).toBe('ACTIVE');
      // The unit was never released, so nothing had to be re-occupied.
      const stillOccupied = await prisma.unit.findUniqueOrThrow({ where: { id: unit.id } });
      expect(stillOccupied.status).toBe('OCCUPIED');
    });

    it('refuses to renew a terminated lease', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);
      const lease = await createLease(app, owner, { tenantId: tenant.id, unitId: unit.id });
      await authed(app, owner).post(`/leases/${lease.id}/terminate`).send({}).expect(201);

      const response = await authed(app, owner)
        .post(`/leases/${lease.id}/renew`)
        .send({ endDate: '2028-12-31' })
        .expect(409);
      expect(response.body.code).toBe('LEASE_TERMINATED');
    });
  });

  describe('lease immutability', () => {
    it('will not move a lease to another tenant or unit', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const otherUnit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);
      const otherTenant = await createTenant(app, owner);
      const lease = await createLease(app, owner, { tenantId: tenant.id, unitId: unit.id });

      // The fields are not on the update DTO at all, so the pipe rejects them.
      await authed(app, owner)
        .patch(`/leases/${lease.id}`)
        .send({ tenantId: otherTenant.id })
        .expect(400);
      await authed(app, owner)
        .patch(`/leases/${lease.id}`)
        .send({ unitId: otherUnit.id })
        .expect(400);
      await authed(app, owner)
        .patch(`/leases/${lease.id}`)
        .send({ startDate: '2020-01-01' })
        .expect(400);

      const unchanged = await authed(app, owner).get(`/leases/${lease.id}`).expect(200);
      expect(unchanged.body.tenantId).toBe(tenant.id);
      expect(unchanged.body.unitId).toBe(unit.id);
    });
  });

  describe('expiry', () => {
    it('lists leases ending within the window and excludes ones outside it', async () => {
      const soonUnit = await createUnit(app, owner, propertyId);
      const laterUnit = await createUnit(app, owner, propertyId);
      const soonTenant = await createTenant(app, owner, { fullName: 'Ending Soon' });
      const laterTenant = await createTenant(app, owner, { fullName: 'Ending Later' });

      const inDays = (days: number) => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + days);
        return date.toISOString().slice(0, 10);
      };

      await createLease(app, owner, {
        tenantId: soonTenant.id,
        unitId: soonUnit.id,
        startDate: '2026-01-01',
        endDate: inDays(20),
      });
      await createLease(app, owner, {
        tenantId: laterTenant.id,
        unitId: laterUnit.id,
        startDate: '2026-01-01',
        endDate: inDays(300),
      });

      const response = await authed(app, owner).get('/leases/expiring?days=60').expect(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].tenant.fullName).toBe('Ending Soon');
      expect(response.body.data[0].daysUntilExpiry).toBeGreaterThan(15);
      expect(response.body.data[0].daysUntilExpiry).toBeLessThanOrEqual(20);
    });

    it('derives EXPIRING_SOON and EXPIRED from the calendar, idempotently', async () => {
      const { LeaseStatusService } = await import('@/modules/leases/lease-status.service');
      const service = new LeaseStatusService(prisma);

      const expiredUnit = await createUnit(app, owner, propertyId);
      const soonUnit = await createUnit(app, owner, propertyId);
      const farUnit = await createUnit(app, owner, propertyId);
      const t1 = await createTenant(app, owner);
      const t2 = await createTenant(app, owner);
      const t3 = await createTenant(app, owner);

      const inDays = (days: number) => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + days);
        return date.toISOString().slice(0, 10);
      };

      const expired = await createLease(app, owner, {
        tenantId: t1.id,
        unitId: expiredUnit.id,
        startDate: '2020-01-01',
        endDate: inDays(-5),
      });
      const soon = await createLease(app, owner, {
        tenantId: t2.id,
        unitId: soonUnit.id,
        startDate: '2026-01-01',
        endDate: inDays(10),
      });
      const far = await createLease(app, owner, {
        tenantId: t3.id,
        unitId: farUnit.id,
        startDate: '2026-01-01',
        endDate: inDays(300),
      });

      const first = await service.deriveFor(owner.organizationId, 60);
      expect(first.expired).toBe(1);
      expect(first.expiringSoon).toBe(1);

      const statuses = await prisma.lease.findMany({
        where: { id: { in: [expired.id, soon.id, far.id] } },
        select: { id: true, status: true },
      });
      const byId = Object.fromEntries(statuses.map((row) => [row.id, row.status]));
      expect(byId[expired.id]).toBe('EXPIRED');
      expect(byId[soon.id]).toBe('EXPIRING_SOON');
      expect(byId[far.id]).toBe('ACTIVE');

      // Running again changes nothing: a missed night is corrected by the next
      // run rather than needing a backfill.
      const second = await service.deriveFor(owner.organizationId, 60);
      expect(second).toEqual({ expired: 0, expiringSoon: 0 });
    });

    it('does NOT free the unit when a lease expires', async () => {
      const { LeaseStatusService } = await import('@/modules/leases/lease-status.service');
      const service = new LeaseStatusService(prisma);

      const unit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);

      await createLease(app, owner, {
        tenantId: tenant.id,
        unitId: unit.id,
        startDate: '2020-01-01',
        endDate: yesterday.toISOString().slice(0, 10),
      });

      await service.deriveFor(owner.organizationId, 60);

      // A tenant staying past the end date is normal; marking the unit vacant
      // would contradict what is actually happening on the ground.
      const stillOccupied = await prisma.unit.findUniqueOrThrow({ where: { id: unit.id } });
      expect(stillOccupied.status).toBe('OCCUPIED');
    });

    it('puts a renewed lease back to ACTIVE on the next derivation', async () => {
      const { LeaseStatusService } = await import('@/modules/leases/lease-status.service');
      const service = new LeaseStatusService(prisma);

      const unit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);
      const inDays = (days: number) => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + days);
        return date.toISOString().slice(0, 10);
      };

      const lease = await createLease(app, owner, {
        tenantId: tenant.id,
        unitId: unit.id,
        startDate: '2026-01-01',
        endDate: inDays(10),
      });

      await service.deriveFor(owner.organizationId, 60);
      let row = await prisma.lease.findUniqueOrThrow({ where: { id: lease.id } });
      expect(row.status).toBe('EXPIRING_SOON');

      await authed(app, owner)
        .post(`/leases/${lease.id}/renew`)
        .send({ endDate: inDays(400) })
        .expect(201);

      await service.deriveFor(owner.organizationId, 60);
      row = await prisma.lease.findUniqueOrThrow({ where: { id: lease.id } });
      expect(row.status).toBe('ACTIVE');
    });
  });

  describe('audit trail', () => {
    it('records the lease lifecycle', async () => {
      const unit = await createUnit(app, owner, propertyId);
      const tenant = await createTenant(app, owner);
      const lease = await createLease(app, owner, { tenantId: tenant.id, unitId: unit.id });
      await authed(app, owner)
        .post(`/leases/${lease.id}/renew`)
        .send({ endDate: '2027-12-31' })
        .expect(201);
      await authed(app, owner).post(`/leases/${lease.id}/terminate`).send({}).expect(201);

      const actions = (
        await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' }, select: { action: true } })
      ).map((log) => log.action);

      expect(actions).toEqual(
        expect.arrayContaining([
          'TENANT_CREATED',
          'LEASE_CREATED',
          'LEASE_RENEWED',
          'LEASE_TERMINATED',
        ]),
      );
    });
  });
});

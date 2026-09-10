import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '@/prisma/prisma.service';
import { BASE, STRONG_PASSWORD, type SignedIn, authed, registerOrganization } from './helpers/api-client';
import { createLease, createProperty, createTenant, createUnit } from './helpers/portfolio';
import { createTestApp, resetDatabase } from './helpers/test-app';

/**
 * Phase 4, end to end: rent is charged, money is taken, receipts are issued and
 * the books balance.
 *
 * These run against a real PostgreSQL. That is the point — the guarantees under
 * test are database guarantees (row locks, unique indexes, CHECK constraints,
 * transaction rollback), and a mocked Prisma would prove none of them.
 */
describe('Finance (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: SignedIn;
  let propertyId: string;
  let unitId: string;
  let tenantId: string;
  let leaseId: string;

  /**
   * Two periods the seeded lease (2026-01-01 → 2026-12-31) covers: one whose
   * due date has passed and one still ahead of it, so both sides of the
   * overdue rule get exercised.
   */
  const PERIOD = '2026-06';
  const FUTURE_PERIOD = '2036-06';

  async function generate(period = PERIOD) {
    const response = await authed(app, owner).post('/rent/generate').send({ period }).expect(201);
    return response.body as {
      periodLabel: string;
      created: number;
      skipped: number;
      expiredLeasesSkipped: number;
    };
  }

  async function chargeFor(period = PERIOD) {
    const response = await authed(app, owner).get('/rent').query({ period }).expect(200);
    return response.body.data[0] as {
      id: string;
      expectedAmount: string;
      paidAmount: string;
      balance: string;
      status: string;
    };
  }

  /** Not async: returns the supertest request so callers can chain .expect(). */
  function pay(
    rentRecordId: string,
    body: Record<string, unknown> = {},
    idempotencyKey?: string,
  ) {
    const req = authed(app, owner).post('/payments');
    if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
    return req.send({
      rentRecordId,
      amount: '10000.00',
      paymentDate: '2026-06-05',
      paymentMethod: 'MPESA',
      ...body,
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

    const property = await createProperty(app, owner, { name: 'Sunrise Estate' });
    propertyId = property.id;
    const unit = await createUnit(app, owner, propertyId, {
      unitNumber: 'A1',
      monthlyRent: '30000.00',
    });
    unitId = unit.id;
    const tenant = await createTenant(app, owner, { fullName: 'Grace Wanjiku' });
    tenantId = tenant.id;
    const lease = await createLease(app, owner, { tenantId, unitId, monthlyRent: '30000.00' });
    leaseId = lease.id;
  });

  describe('generating rent', () => {
    it('creates one charge per active lease and is safe to run twice', async () => {
      const first = await generate();
      expect(first.created).toBe(1);
      expect(first.skipped).toBe(0);

      const second = await generate();
      expect(second.created).toBe(0);
      expect(second.skipped).toBe(1);

      const charges = await prisma.rentRecord.count({ where: { leaseId } });
      expect(charges).toBe(1);
    });

    it('charges the lease rent, not the unit rent, and derives the balance', async () => {
      await authed(app, owner)
        .patch(`/units/${unitId}`)
        .send({ monthlyRent: '99000.00' })
        .expect(200);

      await generate();
      const charge = await chargeFor();

      // The lease is the agreement. Repricing a unit must not silently reprice
      // a sitting tenant's rent.
      expect(charge.expectedAmount).toBe('30000.00');
      expect(charge.paidAmount).toBe('0.00');
      expect(charge.balance).toBe('30000.00');
    });

    it('refuses to bill an expired lease and says how many it skipped', async () => {
      await prisma.lease.update({ where: { id: leaseId }, data: { status: 'EXPIRED' } });

      const result = await generate();
      expect(result.created).toBe(0);
      expect(result.expiredLeasesSkipped).toBe(1);
    });

    it('rejects a period that is not a rental month', async () => {
      await authed(app, owner).post('/rent/generate').send({ period: '2026-13' }).expect(400);
      await authed(app, owner).get('/rent').query({ period: 'June' }).expect(400);
    });
  });

  describe('recording a payment', () => {
    let rentRecordId: string;

    beforeEach(async () => {
      await generate();
      rentRecordId = (await chargeFor()).id;
    });

    it('applies the payment, recomputes the balance and issues a numbered receipt', async () => {
      const response = await pay(rentRecordId, { amount: '10000.00', reference: 'SJK4H7X9QP' });
      expect(response.status).toBe(201);
      expect(response.body.amount).toBe('10000.00');
      expect(response.body.receipt.receiptNumber).toMatch(/^RCP-[A-Z0-9]+-\d{4}-\d{6}$/);

      const charge = await chargeFor();
      expect(charge.paidAmount).toBe('10000.00');
      expect(charge.balance).toBe('20000.00');
      // This charge's due date has passed, and late beats part-paid: what
      // matters operationally is that money is late, not how much arrived.
      expect(charge.status).toBe('OVERDUE');
    });

    it('calls a part payment on a charge that is not yet due partially paid', async () => {
      await prisma.lease.update({
        where: { id: leaseId },
        data: { endDate: new Date('2036-12-31T00:00:00.000Z') },
      });
      await generate(FUTURE_PERIOD);
      const future = await chargeFor(FUTURE_PERIOD);

      await pay(future.id, { amount: '10000.00', reference: 'FUTURE-1' }).expect(201);

      expect((await chargeFor(FUTURE_PERIOD)).status).toBe('PARTIALLY_PAID');
    });

    it('marks the charge paid once the balance reaches zero', async () => {
      await pay(rentRecordId, { amount: '30000.00' }).expect(201);

      const charge = await chargeFor();
      expect(charge.balance).toBe('0.00');
      expect(charge.status).toBe('PAID');
    });

    it('refuses a zero payment as a field error, not a server error', async () => {
      for (const amount of ['0', '0.00', '-1.00']) {
        await pay(rentRecordId, { amount }).expect(400);
      }
      expect(await prisma.payment.count()).toBe(0);
    });

    it('refuses more than is owed rather than holding a credit', async () => {
      const response = await pay(rentRecordId, { amount: '30000.01' });
      expect(response.status).toBe(422);

      // The refusal must leave nothing behind: no payment, no receipt number
      // burned, no partial write.
      expect(await prisma.payment.count()).toBe(0);
      expect(await prisma.receipt.count()).toBe(0);
      expect((await chargeFor()).paidAmount).toBe('0.00');
    });

    it('refuses a reference that has already been recorded for that method', async () => {
      await pay(rentRecordId, { amount: '5000.00', reference: 'SJK4H7X9QP' }).expect(201);

      const duplicate = await pay(rentRecordId, { amount: '5000.00', reference: 'SJK4H7X9QP' });
      expect(duplicate.status).toBe(409);
      expect(await prisma.payment.count()).toBe(1);
    });

    it('replays the original response when the same idempotency key is retried', async () => {
      const key = 'idem-test-key-1';
      const first = await pay(rentRecordId, { amount: '7000.00' }, key).expect(201);
      const retry = await pay(rentRecordId, { amount: '7000.00' }, key).expect(201);

      expect(retry.body.id).toBe(first.body.id);
      expect(retry.body.replayed).toBe(true);

      // The money was taken once, not twice.
      expect(await prisma.payment.count()).toBe(1);
      expect((await chargeFor()).paidAmount).toBe('7000.00');
    });

    it('lets only one of two concurrent full payments through', async () => {
      const [a, b] = await Promise.all([
        pay(rentRecordId, { amount: '30000.00', reference: 'RACE-A' }),
        pay(rentRecordId, { amount: '30000.00', reference: 'RACE-B' }),
      ]);

      // The row lock serialises them: the second sees the balance the first
      // left behind and is refused as an overpayment.
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 422]);
      expect(await prisma.payment.count()).toBe(1);
      expect((await chargeFor()).balance).toBe('0.00');
    });

    it('numbers receipts in an unbroken sequence', async () => {
      await pay(rentRecordId, { amount: '1000.00', reference: 'R1' }).expect(201);
      await pay(rentRecordId, { amount: '1000.00', reference: 'R2' }).expect(201);
      await pay(rentRecordId, { amount: '1000.00', reference: 'R3' }).expect(201);

      const receipts = await prisma.receipt.findMany({ orderBy: { createdAt: 'asc' } });
      const numbers = receipts.map((receipt) => Number(receipt.receiptNumber.split('-').pop()));
      expect(numbers).toEqual([1, 2, 3]);
    });
  });

  describe('voiding a payment', () => {
    let rentRecordId: string;
    let paymentId: string;

    beforeEach(async () => {
      await generate();
      rentRecordId = (await chargeFor()).id;
      const payment = await pay(rentRecordId, { amount: '30000.00', reference: 'VOIDME' }).expect(201);
      paymentId = payment.body.id;
    });

    it('reverses the charge exactly and keeps the receipt number', async () => {
      const before = await prisma.receipt.findFirstOrThrow({ where: { paymentId } });

      await authed(app, owner)
        .post(`/payments/${paymentId}/void`)
        .send({ reason: 'Bank reversed the transfer' })
        .expect(201);

      const charge = await chargeFor();
      expect(charge.paidAmount).toBe('0.00');
      expect(charge.balance).toBe('30000.00');
      expect(charge.status).not.toBe('PAID');

      const after = await prisma.receipt.findFirstOrThrow({ where: { paymentId } });
      expect(after.receiptNumber).toBe(before.receiptNumber);
      expect(after.voidedAt).not.toBeNull();

      // The payment row survives — voided, not deleted.
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(payment.status).toBe('VOIDED');
      expect(payment.voidReason).toBe('Bank reversed the transfer');
    });

    it('frees the reference so the real payment can be re-recorded', async () => {
      await authed(app, owner)
        .post(`/payments/${paymentId}/void`)
        .send({ reason: 'Entered against the wrong month' })
        .expect(201);

      await pay(rentRecordId, { amount: '30000.00', reference: 'VOIDME' }).expect(201);
    });

    it('refuses to void the same payment twice', async () => {
      await authed(app, owner)
        .post(`/payments/${paymentId}/void`)
        .send({ reason: 'First void' })
        .expect(201);

      await authed(app, owner)
        .post(`/payments/${paymentId}/void`)
        .send({ reason: 'Second void' })
        .expect(409);
    });

    it('requires a reason', async () => {
      await authed(app, owner).post(`/payments/${paymentId}/void`).send({ reason: 'x' }).expect(400);
    });

    it('leaves a voided payment out of the collected totals', async () => {
      await authed(app, owner)
        .post(`/payments/${paymentId}/void`)
        .send({ reason: 'Reversed' })
        .expect(201);

      const summary = await authed(app, owner).get('/rent/summary').query({ period: PERIOD }).expect(200);
      expect(summary.body.totals.collected).toBe('0.00');
      expect(summary.body.totals.outstanding).toBe('30000.00');

      const payments = await authed(app, owner).get('/payments').expect(200);
      expect(payments.body.totalAmount).toBe('0.00');
    });
  });

  describe('the books balance', () => {
    it('keeps paidAmount equal to the sum of completed payments across the database', async () => {
      await generate();
      const rentRecordId = (await chargeFor()).id;

      await pay(rentRecordId, { amount: '5000.00', reference: 'B1' }).expect(201);
      await pay(rentRecordId, { amount: '7500.50', reference: 'B2' }).expect(201);
      const voided = await pay(rentRecordId, { amount: '2000.00', reference: 'B3' }).expect(201);
      await authed(app, owner)
        .post(`/payments/${voided.body.id}/void`)
        .send({ reason: 'Reversed by the bank' })
        .expect(201);
      await pay(rentRecordId, { amount: '1000.00', reference: 'B4' }).expect(201);

      /*
       * The reconciliation that matters: for every charge in the database,
       * paidAmount must equal the sum of its completed payments, and balance
       * must equal expected − paid.
       *
       * Asked of the database rather than of the service, so a bug in the
       * service cannot hide behind the same bug in the assertion.
       */
      const drift = await prisma.$queryRaw<{ id: string }[]>`
        SELECT r."id"
        FROM "RentRecord" r
        LEFT JOIN (
          SELECT "rentRecordId", SUM("amount") AS paid
          FROM "Payment"
          WHERE "status" = 'COMPLETED'
          GROUP BY "rentRecordId"
        ) p ON p."rentRecordId" = r."id"
        WHERE r."paidAmount" <> COALESCE(p.paid, 0)
           OR r."balance" <> r."expectedAmount" - r."paidAmount"
      `;
      expect(drift).toEqual([]);

      const charge = await chargeFor();
      expect(charge.paidAmount).toBe('13500.50');
      expect(charge.balance).toBe('16499.50');
    });

    it('reports a summary whose parts add up', async () => {
      await generate();
      const rentRecordId = (await chargeFor()).id;
      await pay(rentRecordId, { amount: '12000.00' }).expect(201);

      const summary = await authed(app, owner).get('/rent/summary').query({ period: PERIOD }).expect(200);
      expect(summary.body.totals.expected).toBe('30000.00');
      expect(summary.body.totals.collected).toBe('12000.00');
      expect(summary.body.totals.outstanding).toBe('18000.00');
      expect(summary.body.totals.collectionRate).toBe(40);
    });

    it('refuses at the database level to store a balance that is not expected minus paid', async () => {
      await generate();
      const charge = await chargeFor();

      // Belt and braces: even a direct write that bypasses the service cannot
      // leave a charge whose numbers contradict each other.
      await expect(
        prisma.rentRecord.update({ where: { id: charge.id }, data: { paidAmount: '5000.00' } }),
      ).rejects.toThrow(/RentRecord_balance_is_derived/);
    });
  });

  describe('expenses', () => {
    it('records, updates, lists and deletes an expense', async () => {
      const created = await authed(app, owner)
        .post('/expenses')
        .send({
          propertyId,
          category: 'REPAIRS',
          description: 'Replaced the water pump',
          amount: '12500.00',
          expenseDate: '2026-06-10',
          vendor: 'Nairobi Pumps Ltd',
        })
        .expect(201);
      expect(created.body.amount).toBe('12500.00');

      const updated = await authed(app, owner)
        .patch(`/expenses/${created.body.id}`)
        .send({ amount: '13000.00' })
        .expect(200);
      expect(updated.body.amount).toBe('13000.00');

      const list = await authed(app, owner).get('/expenses').expect(200);
      expect(list.body.meta.total).toBe(1);
      expect(list.body.totalAmount).toBe('13000.00');

      const summary = await authed(app, owner).get('/expenses/summary').expect(200);
      expect(summary.body.total).toBe('13000.00');
      expect(summary.body.byCategory).toEqual([
        expect.objectContaining({ category: 'REPAIRS', total: '13000.00', count: 1 }),
      ]);

      await authed(app, owner).delete(`/expenses/${created.body.id}`).expect(204);
      await authed(app, owner).get(`/expenses/${created.body.id}`).expect(404);
    });

    it('refuses a zero or negative amount as a field error, not a server error', async () => {
      for (const amount of ['0', '0.00', '0.0', '-100.00']) {
        // 400, specifically: the database CHECK would also stop these, but a
        // constraint violation surfaces as a 500 that blames the server for
        // what the user typed.
        await authed(app, owner)
          .post('/expenses')
          .send({
            propertyId,
            category: 'OTHER',
            description: 'Should not be accepted',
            amount,
            expenseDate: '2026-06-10',
          })
          .expect(400);
      }
      expect(await prisma.expense.count()).toBe(0);
    });

    it('refuses an expense against a property in another organization', async () => {
      const other = await registerOrganization(app, {
        organizationName: 'XYZ Homes',
        fullName: 'Brian Otieno',
        email: 'owner@xyz.test',
        password: STRONG_PASSWORD,
      });
      const foreign = await createProperty(app, other, { name: 'Westlands Court' });

      await authed(app, owner)
        .post('/expenses')
        .send({
          propertyId: foreign.id,
          category: 'OTHER',
          description: 'Cross-tenant write attempt',
          amount: '100.00',
          expenseDate: '2026-06-10',
        })
        .expect(404);
    });
  });

  describe('financial history is never deleted by a convenience action', () => {
    it('refuses to delete a unit that has been charged rent', async () => {
      await generate();
      await authed(app, owner)
        .post(`/leases/${leaseId}/terminate`)
        .send({ reason: 'Tenant moved out' })
        .expect(201);

      const response = await authed(app, owner).delete(`/units/${unitId}`);
      expect(response.status).toBe(409);
      expect(response.body.message).toMatch(/Financial history is never deleted/);
      expect(await prisma.rentRecord.count()).toBe(1);
    });

    it('refuses to delete a property that has expenses booked against it', async () => {
      const empty = await createProperty(app, owner, { name: 'Empty Plot' });
      await authed(app, owner)
        .post('/expenses')
        .send({
          propertyId: empty.id,
          category: 'TAXES',
          description: 'Land rates',
          amount: '8000.00',
          expenseDate: '2026-06-01',
        })
        .expect(201);

      const response = await authed(app, owner).delete(`/properties/${empty.id}`);
      expect(response.status).toBe(409);
      expect(response.body.message).toMatch(/Financial history is never deleted/);
    });
  });

  describe('authentication and CSRF', () => {
    it('refuses every finance route without a session', async () => {
      for (const path of ['/rent', '/rent/summary', '/payments', '/receipts', '/expenses']) {
        await request(app.getHttpServer()).get(`${BASE}${path}`).expect(401);
      }
    });

    it('refuses a payment without the CSRF header', async () => {
      await generate();
      const rentRecordId = (await chargeFor()).id;

      await authed(app, owner)
        .postWithoutCsrf('/payments')
        .send({
          rentRecordId,
          amount: '1000.00',
          paymentDate: '2026-06-05',
          paymentMethod: 'CASH',
        })
        .expect(403);

      expect(await prisma.payment.count()).toBe(0);
    });
  });
});

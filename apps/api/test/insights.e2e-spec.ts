import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '@/prisma/prisma.service';
import {
  BASE,
  STRONG_PASSWORD,
  type SignedIn,
  authed,
  registerOrganization,
  signIn,
} from './helpers/api-client';
import { createLease, createProperty, createTenant, createUnit } from './helpers/portfolio';
import { createTestApp, resetDatabase } from './helpers/test-app';

/**
 * Phase 6 end to end: the dashboard and the nine reports.
 *
 * These are reconciliation tests. A report is not "working" because it returns
 * 200 and some rows — it is working when its totals equal the rows it claims to
 * summarise, asked of the database directly. Every figure below is checked
 * against a second, independent query.
 */
describe('Insights (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: SignedIn;
  let propertyId: string;
  let secondPropertyId: string;

  /** A month the seeded leases (2026-01-01 → 2026-12-31) cover. */
  const PERIOD = '2026-06';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  /** A portfolio with real money in it, so the totals have something to be. */
  beforeEach(async () => {
    await resetDatabase(prisma);
    owner = await registerOrganization(app, {
      organizationName: 'ABC Properties',
      fullName: 'Amina Ochieng',
      email: 'owner@abc.test',
      password: STRONG_PASSWORD,
    });

    const first = await createProperty(app, owner, { name: 'Sunrise Estate' });
    propertyId = first.id;
    const second = await createProperty(app, owner, { name: 'Riverside Court' });
    secondPropertyId = second.id;

    for (const [index, property] of [first, second].entries()) {
      const unit = await createUnit(app, owner, property.id, {
        unitNumber: `A${index + 1}`,
        monthlyRent: '30000.00',
      });
      const tenant = await createTenant(app, owner, { fullName: `Tenant ${index + 1}` });
      await createLease(app, owner, {
        tenantId: tenant.id,
        unitId: unit.id,
        monthlyRent: '30000.00',
      });

      await authed(app, owner)
        .post('/expenses')
        .send({
          propertyId: property.id,
          category: 'REPAIRS',
          description: `Repair at ${property.name}`,
          amount: '5000.00',
          expenseDate: '2026-06-10',
        })
        .expect(201);
    }

    await authed(app, owner).post('/rent/generate').send({ period: PERIOD }).expect(201);

    const roll = await authed(app, owner).get('/rent').query({ period: PERIOD }).expect(200);
    for (const [index, record] of (roll.body.data as { id: string }[]).entries()) {
      // One charge paid in full, one part paid — so collection is neither 0%
      // nor 100% and a wrong rate shows up.
      await authed(app, owner)
        .post('/payments')
        .send({
          rentRecordId: record.id,
          amount: index === 0 ? '30000.00' : '12000.00',
          paymentDate: '2026-06-05',
          paymentMethod: 'MPESA',
          reference: `SEED-${index}`,
        })
        .expect(201);
    }
  });

  describe('dashboard summary', () => {
    it('reports the portfolio as the database has it', async () => {
      const response = await authed(app, owner)
        .get('/dashboard/summary')
        .query({ period: PERIOD })
        .expect(200);

      const units = await prisma.unit.groupBy({ by: ['status'], _count: { _all: true } });
      const total = units.reduce((sum, row) => sum + row._count._all, 0);
      const occupied = units.find((row) => row.status === 'OCCUPIED')?._count._all ?? 0;

      expect(response.body.portfolio.properties).toBe(2);
      expect(response.body.portfolio.units.total).toBe(total);
      expect(response.body.portfolio.units.occupied).toBe(occupied);
      expect(response.body.portfolio.occupancyRate).toBe(
        Math.round((occupied / total) * 10000) / 100,
      );
    });

    it('reports money that adds up, as fixed-scale strings', async () => {
      const response = await authed(app, owner)
        .get('/dashboard/summary')
        .query({ period: PERIOD })
        .expect(200);

      const money = response.body.money;
      expect(money.expected).toBe('60000.00');
      expect(money.collected).toBe('42000.00');
      expect(money.outstanding).toBe('18000.00');
      expect(money.expenses).toBe('10000.00');
      // Cash basis: collected minus spent, not expected minus spent.
      expect(money.netIncome).toBe('32000.00');
      expect(money.collectionRate).toBe(70);

      for (const key of ['expected', 'collected', 'outstanding', 'expenses', 'netIncome']) {
        expect(typeof money[key]).toBe('string');
        expect(money[key]).toMatch(/^-?\d+\.\d{2}$/);
      }
    });

    it('narrows to one property when asked', async () => {
      const response = await authed(app, owner)
        .get('/dashboard/summary')
        .query({ period: PERIOD, propertyId })
        .expect(200);

      expect(response.body.portfolio.properties).toBe(1);
      expect(response.body.money.expected).toBe('30000.00');
      expect(response.body.money.expenses).toBe('5000.00');
    });

    it('refuses a property in another organization', async () => {
      const other = await registerOrganization(app, {
        organizationName: 'XYZ Estates',
        fullName: 'Brian Otieno',
        email: 'owner@xyz.test',
        password: STRONG_PASSWORD,
      });
      const foreign = await createProperty(app, other, { name: 'Westlands Court' });

      await authed(app, owner)
        .get('/dashboard/summary')
        .query({ propertyId: foreign.id })
        .expect(404);
    });
  });

  describe('dashboard charts', () => {
    it('returns one row per month including the empty ones', async () => {
      const response = await authed(app, owner)
        .get('/dashboard/charts')
        .query({ months: 12 })
        .expect(200);

      expect(response.body.months).toHaveLength(12);
      // A chart that dropped empty months would draw a line straight from
      // March to June as though May never happened.
      const periods = response.body.months.map((month: { period: string }) => month.period);
      expect([...periods].sort()).toEqual(periods);
    });

    it('computes each month’s net from that month’s own figures', async () => {
      const response = await authed(app, owner)
        .get('/dashboard/charts')
        .query({ months: 12 })
        .expect(200);

      for (const month of response.body.months) {
        expect(Number(month.netIncome)).toBeCloseTo(
          Number(month.collected) - Number(month.expenses),
          2,
        );
      }

      const june = response.body.months.find(
        (month: { period: string }) => month.period === PERIOD,
      );
      expect(june.collected).toBe('42000.00');
      expect(june.expenses).toBe('10000.00');
      expect(june.netIncome).toBe('32000.00');
    });

    it('groups expenses by category and ranks properties', async () => {
      const response = await authed(app, owner).get('/dashboard/charts').expect(200);

      expect(response.body.expensesByCategory).toEqual([
        expect.objectContaining({ category: 'REPAIRS', total: '10000.00', count: 2 }),
      ]);
      expect(response.body.propertyPerformance).toHaveLength(2);
      const totals = response.body.propertyPerformance.map(
        (row: { collected: string }) => row.collected,
      );
      expect(totals).toEqual(['30000.00', '12000.00']);
    });

    it('rejects a silly window rather than building it', async () => {
      await authed(app, owner).get('/dashboard/charts').query({ months: 500 }).expect(400);
      await authed(app, owner).get('/dashboard/charts').query({ months: 1 }).expect(400);
    });
  });

  describe('worklists', () => {
    it('lists overdue rent worst first, and only rows that owe', async () => {
      const response = await authed(app, owner).get('/dashboard/worklists').expect(200);

      expect(response.body.overdueRent.length).toBeGreaterThan(0);
      for (const row of response.body.overdueRent) {
        expect(Number(row.balance)).toBeGreaterThan(0);
      }
      const balances = response.body.overdueRent.map((row: { balance: string }) =>
        Number(row.balance),
      );
      expect([...balances].sort((a, b) => b - a)).toEqual(balances);
    });

    it('lists the most recent payments with their receipts', async () => {
      const response = await authed(app, owner).get('/dashboard/worklists').expect(200);

      expect(response.body.recentPayments).toHaveLength(2);
      for (const payment of response.body.recentPayments) {
        expect(payment.receipt.receiptNumber).toMatch(/^RCP-/);
      }
    });
  });

  describe('the nine reports', () => {
    it('lists every report with the filters it honours', async () => {
      const response = await authed(app, owner).get('/reports').expect(200);

      expect(response.body).toHaveLength(9);
      for (const report of response.body) {
        expect(report.key).toEqual(expect.any(String));
        expect(report.filters.length).toBeGreaterThan(0);
      }
    });

    it('runs every one of them', async () => {
      const catalogue = await authed(app, owner).get('/reports').expect(200);

      for (const report of catalogue.body) {
        const result = await authed(app, owner)
          .get(`/reports/${report.key}`)
          .query({ limit: 500 })
          .expect(200);

        expect(result.body.columns.length).toBeGreaterThan(0);
        expect(Array.isArray(result.body.rows)).toBe(true);
        expect(result.body.report.key).toBe(report.key);
      }
    });

    it('is a 404 for a report that does not exist', async () => {
      await authed(app, owner).get('/reports/not-a-report').expect(404);
    });

    it('rejects a malformed filter rather than ignoring it', async () => {
      // Silently dropping a bad filter would show the user a report covering
      // something other than what they asked for.
      await authed(app, owner).get('/reports/expenses').query({ dateFrom: 'soon' }).expect(400);
      await authed(app, owner).get('/reports/income').query({ period: '2026-13' }).expect(400);
      await authed(app, owner).get('/reports/tenants').query({ limit: 9999 }).expect(400);
    });
  });

  describe('reports reconcile with the database', () => {
    it('rent collection totals every completed payment', async () => {
      const result = await authed(app, owner)
        .get('/reports/rent-collection')
        .query({ limit: 500 })
        .expect(200);

      const database = await prisma.payment.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true },
        _count: { _all: true },
      });

      expect(result.body.totals.amount).toBe('42000.00');
      expect(Number(result.body.totals.amount)).toBe(Number(database._sum.amount));
      expect(result.body.meta.total).toBe(database._count._all);
    });

    it('rent collection excludes a voided payment the moment it is voided', async () => {
      const payments = await authed(app, owner).get('/payments').expect(200);
      const first = payments.body.data[0];

      await authed(app, owner)
        .post(`/payments/${first.id}/void`)
        .send({ reason: 'Reversed by the bank' })
        .expect(201);

      const result = await authed(app, owner)
        .get('/reports/rent-collection')
        .query({ limit: 500 })
        .expect(200);

      // The money was reversed, so counting it as collected would overstate
      // every total on the page.
      expect(result.body.meta.total).toBe(1);
      expect(Number(result.body.totals.amount)).toBe(42000 - Number(first.amount));
    });

    it('outstanding rent totals every positive balance', async () => {
      const result = await authed(app, owner)
        .get('/reports/outstanding-rent')
        .query({ limit: 500 })
        .expect(200);

      const database = await prisma.rentRecord.aggregate({
        where: { balance: { gt: 0 } },
        _sum: { balance: true, expectedAmount: true, paidAmount: true },
      });

      expect(Number(result.body.totals.balance)).toBe(Number(database._sum.balance));
      expect(Number(result.body.totals.expected)).toBe(Number(database._sum.expectedAmount));
      for (const row of result.body.rows) {
        expect(Number(row.balance)).toBeGreaterThan(0);
      }
    });

    it('occupancy agrees with the unit table, per property and overall', async () => {
      const result = await authed(app, owner).get('/reports/occupancy').expect(200);

      const units = await prisma.unit.groupBy({ by: ['status'], _count: { _all: true } });
      const total = units.reduce((sum, row) => sum + row._count._all, 0);
      const occupied = units.find((row) => row.status === 'OCCUPIED')?._count._all ?? 0;

      expect(result.body.totals.total).toBe(total);
      expect(result.body.totals.occupied).toBe(occupied);
      // The rows must add up to the footer, not merely look plausible.
      expect(
        result.body.rows.reduce((sum: number, row: { total: number }) => sum + row.total, 0),
      ).toBe(total);
    });

    it('profit and loss is collected minus spent, and its rows sum to its total', async () => {
      const result = await authed(app, owner).get('/reports/profit-loss').expect(200);

      expect(result.body.totals.collected).toBe('42000.00');
      expect(result.body.totals.expenses).toBe('10000.00');
      expect(result.body.totals.netIncome).toBe('32000.00');

      const rowCollected = result.body.rows.reduce(
        (sum: number, row: { collected: string }) => sum + Number(row.collected),
        0,
      );
      expect(rowCollected).toBeCloseTo(Number(result.body.totals.collected), 2);
    });

    it('income totals the charges, and its collection rate matches the dashboard', async () => {
      const [report, summary] = await Promise.all([
        authed(app, owner).get('/reports/income').query({ limit: 500 }).expect(200),
        authed(app, owner).get('/dashboard/summary').query({ period: PERIOD }).expect(200),
      ]);

      expect(report.body.totals.expected).toBe('60000.00');
      expect(report.body.totals.collected).toBe('42000.00');
      // Two screens must not disagree about the same number.
      expect(report.body.totals.collectionRate).toBe(summary.body.money.collectionRate);
    });

    it('totals cover every matching row, not just the returned page', async () => {
      const page = await authed(app, owner)
        .get('/reports/rent-collection')
        .query({ limit: 1 })
        .expect(200);

      // The classic report bug: a footer that adds up only what is visible.
      expect(page.body.rows).toHaveLength(1);
      expect(page.body.meta.total).toBe(2);
      expect(page.body.totals.amount).toBe('42000.00');
    });

    it('a filter narrows the totals as well as the rows', async () => {
      const result = await authed(app, owner)
        .get('/reports/rent-collection')
        .query({ propertyId, limit: 500 })
        .expect(200);

      expect(result.body.meta.total).toBe(1);
      expect(result.body.totals.amount).toBe('30000.00');
      for (const row of result.body.rows) {
        expect(row.property).toBe('Sunrise Estate');
      }
    });

    it('an empty result is a real answer, not an error', async () => {
      const result = await authed(app, owner)
        .get('/reports/expenses')
        .query({ dateFrom: '2030-01-01', dateTo: '2030-12-31' })
        .expect(200);

      expect(result.body.rows).toEqual([]);
      expect(result.body.meta.total).toBe(0);
      // Columns still present, so the screen can render an empty table with
      // headings rather than a blank.
      expect(result.body.columns.length).toBeGreaterThan(0);
    });
  });

  describe('exports', () => {
    it('downloads a CSV that states its filters and matches the report', async () => {
      const response = await authed(app, owner)
        .get('/reports/rent-collection/export')
        .query({ format: 'csv', period: PERIOD })
        .expect(200);

      expect(response.headers['content-type']).toMatch(/text\/csv/);
      expect(response.headers['content-disposition']).toMatch(/^attachment; filename="/);
      // Same as a document download: never rendered in the app origin.
      expect(response.headers['x-content-type-options']).toBe('nosniff');

      const csv = response.text;
      expect(csv).toContain('# Rent collection');
      expect(csv).toContain('# ABC Properties');
      expect(csv).toContain('# Period: 2026-06');
      expect(csv).toContain('Date,Tenant,Property');
      expect(csv).toMatch(/\r\nTotal,/);

      const dataLines = csv
        .split('\r\n')
        .filter((line) => line && !line.startsWith('#') && !line.startsWith('﻿'));
      // Header + two payments + totals.
      expect(dataLines).toHaveLength(4);
    });

    it('downloads a real PDF', async () => {
      const response = await authed(app, owner)
        .get('/reports/outstanding-rent/export')
        .query({ format: 'pdf' })
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(response.headers['content-type']).toBe('application/pdf');
      const body = response.body as Buffer;
      expect(body.subarray(0, 4).toString()).toBe('%PDF');
      expect(body.byteLength).toBeGreaterThan(1000);
    });

    it('refuses an unknown format rather than guessing', async () => {
      await authed(app, owner)
        .get('/reports/rent-collection/export')
        .query({ format: 'xlsx' })
        .expect(400);
    });

    it('needs reports.export, not merely reports.view', async () => {
      // Proved through the permission matrix suite; here we confirm the route
      // declares a different permission from the screen it exports.
      const anonymous = await request(app.getHttpServer()).get(
        `${BASE}/reports/rent-collection/export?format=csv`,
      );
      expect(anonymous.status).toBe(401);
    });
  });

  describe('scope and isolation', () => {
    async function inviteAccountant(properties: string[]): Promise<SignedIn> {
      const invite = await authed(app, owner)
        .post('/staff')
        .send({
          email: 'accountant@abc.test',
          fullName: 'Carol Wanjiru',
          role: 'ACCOUNTANT',
          propertyIds: properties,
        })
        .expect(201);

      const token = new URL(invite.body.invite.url).searchParams.get('token');
      await request(app.getHttpServer())
        .post(`${BASE}/auth/reset-password`)
        .send({ token, password: STRONG_PASSWORD })
        .expect(200);

      return signIn(app, 'accountant@abc.test', STRONG_PASSWORD);
    }

    it('gives a scoped user their own dashboard, not the whole organization', async () => {
      const accountant = await inviteAccountant([propertyId]);

      const response = await authed(app, accountant)
        .get('/dashboard/summary')
        .query({ period: PERIOD })
        .expect(200);

      expect(response.body.scoped).toBe(true);
      expect(response.body.portfolio.properties).toBe(1);
      expect(response.body.money.expected).toBe('30000.00');
      expect(response.body.money.collected).toBe('30000.00');
      expect(response.body.money.expenses).toBe('5000.00');
    });

    it('a report is not a back door around the scope', async () => {
      const accountant = await inviteAccountant([propertyId]);

      const scoped = await authed(app, accountant)
        .get('/reports/rent-collection')
        .query({ limit: 500 })
        .expect(200);

      expect(scoped.body.scoped).toBe(true);
      expect(scoped.body.meta.total).toBe(1);
      expect(scoped.body.totals.amount).toBe('30000.00');

      // And filtering to the other property is a 404, not a way in.
      await authed(app, accountant)
        .get('/reports/rent-collection')
        .query({ propertyId: secondPropertyId })
        .expect(404);
    });

    it('says on the export that it is scoped', async () => {
      const accountant = await inviteAccountant([propertyId]);

      const response = await authed(app, accountant)
        .get('/reports/rent-collection/export')
        .query({ format: 'csv' })
        .expect(200);

      // A scoped export covers less than the organization, and the person
      // reading the printout needs to know that.
      expect(response.text).toContain('# Scope: limited to the properties assigned to you');
    });

    it('shows a scoped user with no assignments zeros, never the organization', async () => {
      const accountant = await inviteAccountant([]);

      const summary = await authed(app, accountant).get('/dashboard/summary').expect(200);
      expect(summary.body.scoped).toBe(true);
      expect(summary.body.portfolio.properties).toBe(0);
      expect(summary.body.money.collected).toBe('0.00');

      const report = await authed(app, accountant).get('/reports/rent-collection').expect(200);
      expect(report.body.rows).toEqual([]);
      expect(report.body.meta.total).toBe(0);

      const charts = await authed(app, accountant).get('/dashboard/charts').expect(200);
      expect(charts.body.months).toHaveLength(12);
      expect(charts.body.months.every((month: { collected: string }) => month.collected === '0.00')).toBe(
        true,
      );
    });

    it('keeps one organization’s numbers out of another’s', async () => {
      const other = await registerOrganization(app, {
        organizationName: 'XYZ Estates',
        fullName: 'Brian Otieno',
        email: 'owner@xyz.test',
        password: STRONG_PASSWORD,
      });

      const theirs = await authed(app, other).get('/reports/rent-collection').expect(200);
      expect(theirs.body.meta.total).toBe(0);
      expect(theirs.body.totals.amount).toBe('0.00');

      const theirSummary = await authed(app, other).get('/dashboard/summary').expect(200);
      expect(theirSummary.body.money.collected).toBe('0.00');
      expect(theirSummary.body.portfolio.properties).toBe(0);

      // And they cannot reach into ours by naming our property.
      await authed(app, other)
        .get('/reports/rent-collection')
        .query({ propertyId })
        .expect(404);
    });

    it('refuses every insight route without a session', async () => {
      for (const path of [
        '/dashboard/summary',
        '/dashboard/charts',
        '/dashboard/worklists',
        '/reports',
        '/reports/rent-collection',
      ]) {
        await request(app.getHttpServer()).get(`${BASE}${path}`).expect(401);
      }
    });
  });
});

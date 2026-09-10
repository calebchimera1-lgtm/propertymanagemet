import type { PrismaClient } from '@pm/database';

/**
 * Rent charges, payments and expenses for development and the end-to-end suite.
 *
 * Written through the same arithmetic the application uses, so the seeded
 * database is one the app could actually have produced: every rent record's
 * balance equals expected minus paid, and every payment has a receipt.
 *
 * The spread is deliberate — some months fully paid, some partly, some not at
 * all — so the collections worklist and the collection rate have something real
 * to show rather than a wall of zeroes or a wall of green.
 */

const EXPENSES = [
  { category: 'MAINTENANCE' as const, description: 'Replaced the water pump', amount: '18500.00', vendor: 'Nairobi Pumps Ltd' },
  { category: 'SECURITY' as const, description: 'Monthly guard services', amount: '45000.00', vendor: 'SafeGuard Kenya' },
  { category: 'CLEANING' as const, description: 'Common area cleaning', amount: '12000.00', vendor: 'BrightClean' },
  { category: 'WATER' as const, description: 'Water bill', amount: '23400.00', vendor: 'Nairobi Water' },
  { category: 'ELECTRICITY' as const, description: 'Common area electricity', amount: '9800.00', vendor: 'Kenya Power' },
  { category: 'REPAIRS' as const, description: 'Roof leak repair, Block B', amount: '31000.00', vendor: 'Mwangi Builders' },
  { category: 'GARBAGE' as const, description: 'Refuse collection', amount: '7500.00', vendor: 'CleanCity' },
];

function monthsAgo(months: number): { year: number; month: number } {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

export async function seedFinance(prisma: PrismaClient): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed financial demo data in production.');
  }

  const abc = await prisma.organization.findUnique({ where: { code: 'ABC' } });
  if (!abc) return;

  const settings = await prisma.settings.findUnique({ where: { organizationId: abc.id } });
  const prefix = settings?.receiptPrefix ?? 'RCP';

  const leases = await prisma.lease.findMany({
    where: { organizationId: abc.id, status: { in: ['ACTIVE', 'EXPIRING_SOON'] } },
    select: {
      id: true,
      tenantId: true,
      propertyId: true,
      buildingId: true,
      unitId: true,
      monthlyRent: true,
      dueDay: true,
      startDate: true,
    },
  });

  let charges = 0;
  let payments = 0;
  let receiptCounter = 0;
  const year = new Date().getUTCFullYear();

  // Three months back to this one, so trends have more than a single point.
  for (let offset = 3; offset >= 0; offset--) {
    const { year: periodYear, month } = monthsAgo(offset);
    const periodStart = new Date(Date.UTC(periodYear, month, 1));
    const periodEnd = new Date(Date.UTC(periodYear, month + 1, 0));
    const periodLabel = `${periodYear}-${String(month + 1).padStart(2, '0')}`;

    for (const [index, lease] of leases.entries()) {
      if (lease.startDate > periodEnd) continue;

      const dueDate = new Date(Date.UTC(periodYear, month, lease.dueDay));
      const expected = lease.monthlyRent;

      // Older months are mostly settled; the current one is still coming in.
      const settlement = offset === 0 ? index % 3 : index % 4 === 0 ? 1 : 0;
      const paid =
        settlement === 0 ? expected : settlement === 1 ? expected.dividedBy(2).toDecimalPlaces(2) : expected.minus(expected);

      const balance = expected.minus(paid);
      const status = balance.isZero()
        ? 'PAID'
        : dueDate < new Date()
          ? 'OVERDUE'
          : paid.greaterThan(0)
            ? 'PARTIALLY_PAID'
            : 'PENDING';

      const record = await prisma.rentRecord.upsert({
        where: { leaseId_periodStart: { leaseId: lease.id, periodStart } },
        create: {
          organizationId: abc.id,
          leaseId: lease.id,
          tenantId: lease.tenantId,
          propertyId: lease.propertyId,
          buildingId: lease.buildingId,
          unitId: lease.unitId,
          periodStart,
          periodEnd,
          periodLabel,
          expectedAmount: expected,
          paidAmount: paid,
          balance,
          dueDate,
          status,
        },
        update: {},
        select: { id: true, paidAmount: true },
      });
      charges++;

      if (paid.isZero()) continue;

      const already = await prisma.payment.count({ where: { rentRecordId: record.id } });
      if (already > 0) continue;

      const paymentDate = new Date(Date.UTC(periodYear, month, Math.min(lease.dueDay + 2, 28)));
      receiptCounter++;

      const payment = await prisma.payment.create({
        data: {
          organizationId: abc.id,
          tenantId: lease.tenantId,
          propertyId: lease.propertyId,
          buildingId: lease.buildingId,
          unitId: lease.unitId,
          leaseId: lease.id,
          rentRecordId: record.id,
          amount: paid,
          paymentDate,
          paymentMethod: index % 2 === 0 ? 'MPESA' : 'BANK',
          reference: `SEED-${periodLabel}-${index}`,
          periodLabel,
          status: 'COMPLETED',
        },
      });

      await prisma.receipt.create({
        data: {
          organizationId: abc.id,
          paymentId: payment.id,
          receiptNumber: `${prefix}-${abc.code}-${year}-${String(900000 + receiptCounter).padStart(6, '0')}`,
          tenantId: lease.tenantId,
          propertyId: lease.propertyId,
          unitId: lease.unitId,
          amount: paid,
          paymentMethod: payment.paymentMethod,
          reference: payment.reference,
          paymentDate,
          periodLabel,
        },
      });
      payments++;
    }
  }

  // Keep the seeded receipt numbers out of the live counter's way.
  await prisma.numberSequence.upsert({
    where: { organizationId_key_year: { organizationId: abc.id, key: 'RECEIPT', year } },
    create: { organizationId: abc.id, key: 'RECEIPT', year, lastValue: 900000 + receiptCounter },
    update: {},
  });

  const properties = await prisma.property.findMany({
    where: { organizationId: abc.id },
    select: { id: true },
  });

  let expenseCount = 0;
  for (let offset = 3; offset >= 0; offset--) {
    const { year: expenseYear, month } = monthsAgo(offset);
    for (const [index, expense] of EXPENSES.entries()) {
      const property = properties[index % properties.length];
      if (!property) continue;

      const expenseDate = new Date(Date.UTC(expenseYear, month, Math.min(3 + index * 3, 28)));
      if (expenseDate > new Date()) continue;

      const reference = `EXP-${expenseYear}-${month + 1}-${index}`;
      const exists = await prisma.expense.findFirst({
        where: { organizationId: abc.id, reference },
        select: { id: true },
      });
      if (exists) continue;

      await prisma.expense.create({
        data: {
          organizationId: abc.id,
          propertyId: property.id,
          category: expense.category,
          description: expense.description,
          amount: expense.amount,
          expenseDate,
          paymentMethod: 'BANK',
          vendor: expense.vendor,
          reference,
        },
      });
      expenseCount++;
    }
  }

  console.log(`  ${charges} rent charges, ${payments} payments with receipts, ${expenseCount} expenses`);
  console.log('  Four months of history, with a mix of paid, part-paid and unpaid charges.');
}

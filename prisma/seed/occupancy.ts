import type { Prisma, PrismaClient } from '@pm/database';

/**
 * Tenants and leases for development and the end-to-end suite.
 *
 * Leases are seeded through the same rules the API enforces: creating one
 * occupies its unit, and no unit ever carries two active leases. That keeps the
 * seeded database in a state the application could actually have produced.
 *
 * A deliberate spread of end dates gives the expiry screens something real to
 * show: one lease already past its end date, one inside the warning window, and
 * the rest running well into the future.
 */

interface TenantPlan {
  fullName: string;
  phone: string;
  email: string;
  nationalId: string;
  occupation: string;
  /** Months from today the lease ends. Negative means already expired. */
  leaseEndsInMonths?: number;
}

const ABC_TENANTS: TenantPlan[] = [
  { fullName: 'Grace Wanjiku', phone: '+254711000001', email: 'grace@tenants.test', nationalId: '20000001', occupation: 'Teacher', leaseEndsInMonths: 10 },
  { fullName: 'Peter Kamau', phone: '+254711000002', email: 'peter@tenants.test', nationalId: '20000002', occupation: 'Engineer', leaseEndsInMonths: 8 },
  { fullName: 'Mary Atieno', phone: '+254711000003', email: 'mary@tenants.test', nationalId: '20000003', occupation: 'Nurse', leaseEndsInMonths: 1 },
  { fullName: 'John Mwangi', phone: '+254711000004', email: 'john@tenants.test', nationalId: '20000004', occupation: 'Driver', leaseEndsInMonths: -1 },
  { fullName: 'Faith Chebet', phone: '+254711000005', email: 'faith@tenants.test', nationalId: '20000005', occupation: 'Accountant', leaseEndsInMonths: 14 },
  { fullName: 'Samuel Odhiambo', phone: '+254711000006', email: 'samuel@tenants.test', nationalId: '20000006', occupation: 'Shopkeeper', leaseEndsInMonths: 6 },
  // No lease: someone on file who has not moved in yet.
  { fullName: 'Lucy Nafula', phone: '+254711000007', email: 'lucy@tenants.test', nationalId: '20000007', occupation: 'Consultant' },
  { fullName: 'David Kiplagat', phone: '+254711000008', email: 'david@tenants.test', nationalId: '20000008', occupation: 'Chef' },
];

const XYZ_TENANTS: TenantPlan[] = [
  { fullName: 'Halima Said', phone: '+254722000001', email: 'halima@tenants.test', nationalId: '30000001', occupation: 'Tour guide', leaseEndsInMonths: 9 },
  { fullName: 'Omar Juma', phone: '+254722000002', email: 'omar@tenants.test', nationalId: '30000002', occupation: 'Fisherman', leaseEndsInMonths: 4 },
];

function monthsFromNow(months: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date;
}

function leaseStart(endDate: Date): Date {
  const start = new Date(endDate);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  return start;
}

async function seedFor(
  prisma: PrismaClient,
  organizationId: string,
  plans: TenantPlan[],
): Promise<{ tenants: number; leases: number }> {
  // Only vacant units are eligible, exactly as the API requires.
  const vacantUnits = await prisma.unit.findMany({
    where: { organizationId, status: 'VACANT' },
    orderBy: [{ propertyId: 'asc' }, { unitNumber: 'asc' }],
    select: {
      id: true,
      propertyId: true,
      buildingId: true,
      monthlyRent: true,
      securityDeposit: true,
    },
  });

  let unitIndex = 0;
  let leases = 0;

  for (const plan of plans) {
    const tenant = await prisma.tenant.upsert({
      where: {
        organizationId_id: { organizationId, id: `seed-${plan.nationalId}` },
      },
      create: {
        id: `seed-${plan.nationalId}`,
        organizationId,
        fullName: plan.fullName,
        phone: plan.phone,
        email: plan.email,
        idType: 'NATIONAL_ID',
        nationalId: plan.nationalId,
        occupation: plan.occupation,
        emergencyContactName: 'Next of Kin',
        emergencyContactPhone: '+254700999999',
      },
      update: { fullName: plan.fullName, phone: plan.phone },
      select: { id: true },
    });

    if (plan.leaseEndsInMonths === undefined) continue;

    const unit = vacantUnits[unitIndex];
    if (!unit) continue;
    unitIndex++;

    const existing = await prisma.lease.findFirst({
      where: { tenantId: tenant.id, unitId: unit.id },
      select: { id: true },
    });
    if (existing) continue;

    const endDate = monthsFromNow(plan.leaseEndsInMonths);
    const isExpired = plan.leaseEndsInMonths < 0;

    // Lease and unit status change together, as they do in the application.
    await prisma.$transaction(async (tx) => {
      await tx.lease.create({
        data: {
          organizationId,
          tenantId: tenant.id,
          propertyId: unit.propertyId,
          buildingId: unit.buildingId,
          unitId: unit.id,
          startDate: leaseStart(endDate),
          endDate,
          monthlyRent: unit.monthlyRent,
          securityDeposit: unit.securityDeposit,
          depositPaid: unit.securityDeposit,
          dueDay: 5,
          // The nightly job derives these; seeding them straight keeps the
          // demo data consistent from the first page load.
          status: isExpired ? 'EXPIRED' : 'ACTIVE',
        } satisfies Prisma.LeaseUncheckedCreateInput,
      });

      // An expired lease does not free the unit: a tenant staying past the end
      // date is normal, and marking the unit vacant would contradict reality.
      await tx.unit.update({ where: { id: unit.id }, data: { status: 'OCCUPIED' } });
    });

    leases++;
  }

  return { tenants: plans.length, leases };
}

export async function seedOccupancy(prisma: PrismaClient): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed occupancy demo data in production.');
  }

  const abc = await prisma.organization.findUnique({ where: { code: 'ABC' } });
  const xyz = await prisma.organization.findUnique({ where: { code: 'XYZ' } });
  if (!abc || !xyz) return;

  const abcTotals = await seedFor(prisma, abc.id, ABC_TENANTS);
  const xyzTotals = await seedFor(prisma, xyz.id, XYZ_TENANTS);

  console.log(`  ABC Properties — ${abcTotals.tenants} tenants, ${abcTotals.leases} leases`);
  console.log(`  XYZ Estates    — ${xyzTotals.tenants} tenants, ${xyzTotals.leases} leases`);
  console.log('  Includes one expired lease and one expiring within a month.');
}

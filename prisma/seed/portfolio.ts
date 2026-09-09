import type { Prisma, PrismaClient } from '@pm/database';

/**
 * Realistic portfolio data for development and the end-to-end suite.
 *
 * ABC Properties gets a mixed portfolio big enough that pagination, filtering
 * and sorting are actually exercised; XYZ Estates gets its own, so the
 * isolation tests have something on both sides of the boundary to compare.
 *
 * Staff assignments are deliberately partial: the caretaker sees one property
 * out of three, which is what makes the property-scope tests meaningful.
 */

interface UnitPlan {
  count: number;
  type: Prisma.UnitCreateManyInput['unitType'];
  rent: string;
  deposit: string;
  bedrooms: number;
  bathrooms: number;
}

interface BuildingPlan {
  name: string;
  floors: number;
  units: UnitPlan[];
}

interface PropertyPlan {
  name: string;
  type: Prisma.PropertyCreateManyInput['propertyType'];
  city: string;
  county: string;
  buildings: BuildingPlan[];
  /** Units attached directly to the property, with no block in between. */
  looseUnits?: UnitPlan[];
}

const ABC_PORTFOLIO: PropertyPlan[] = [
  {
    name: 'Sunrise Estate',
    type: 'APARTMENT',
    city: 'Nairobi',
    county: 'Nairobi',
    buildings: [
      {
        name: 'Block A',
        floors: 4,
        units: [
          { count: 4, type: 'ONE_BEDROOM', rent: '32000.00', deposit: '32000.00', bedrooms: 1, bathrooms: 1 },
          { count: 4, type: 'TWO_BEDROOM', rent: '48000.00', deposit: '48000.00', bedrooms: 2, bathrooms: 2 },
        ],
      },
      {
        name: 'Block B',
        floors: 4,
        units: [
          { count: 6, type: 'BEDSITTER', rent: '18000.00', deposit: '18000.00', bedrooms: 0, bathrooms: 1 },
          { count: 2, type: 'THREE_BEDROOM', rent: '75000.00', deposit: '75000.00', bedrooms: 3, bathrooms: 2 },
        ],
      },
    ],
  },
  {
    name: 'Riverside Court',
    type: 'RESIDENTIAL',
    city: 'Nairobi',
    county: 'Nairobi',
    buildings: [
      {
        name: 'Main House Block',
        floors: 3,
        units: [
          { count: 6, type: 'TWO_BEDROOM', rent: '55000.00', deposit: '55000.00', bedrooms: 2, bathrooms: 2 },
        ],
      },
    ],
  },
  {
    name: 'Kilimani Business Plaza',
    type: 'COMMERCIAL',
    city: 'Nairobi',
    county: 'Nairobi',
    buildings: [],
    looseUnits: [
      { count: 5, type: 'SHOP', rent: '65000.00', deposit: '130000.00', bedrooms: 0, bathrooms: 1 },
      { count: 3, type: 'OFFICE', rent: '90000.00', deposit: '180000.00', bedrooms: 0, bathrooms: 1 },
    ],
  },
];

const XYZ_PORTFOLIO: PropertyPlan[] = [
  {
    name: 'Nyali Gardens',
    type: 'APARTMENT',
    city: 'Mombasa',
    county: 'Mombasa',
    buildings: [
      {
        name: 'Palm Wing',
        floors: 3,
        units: [
          { count: 6, type: 'TWO_BEDROOM', rent: '42000.00', deposit: '42000.00', bedrooms: 2, bathrooms: 2 },
        ],
      },
    ],
  },
];

function unitRows(
  plans: UnitPlan[],
  base: { organizationId: string; propertyId: string; buildingId: string | null; prefix: string },
): Prisma.UnitCreateManyInput[] {
  const rows: Prisma.UnitCreateManyInput[] = [];
  let sequence = 1;

  for (const plan of plans) {
    for (let index = 0; index < plan.count; index++) {
      const number = `${base.prefix}${String(sequence).padStart(2, '0')}`;
      rows.push({
        organizationId: base.organizationId,
        propertyId: base.propertyId,
        buildingId: base.buildingId,
        unitNumber: number,
        unitType: plan.type,
        floor: Math.ceil(sequence / 4),
        bedrooms: plan.bedrooms,
        bathrooms: plan.bathrooms,
        monthlyRent: plan.rent,
        securityDeposit: plan.deposit,
        // Every unit starts vacant. From Phase 3 the status is driven by leases,
        // so seeding a mix of OCCUPIED units with no tenant behind them would be
        // inventing data the rest of the system cannot explain.
        status: 'VACANT',
        waterMeterNumber: `WM-${number}-${sequence}`,
        electricityMeterNumber: `EM-${number}-${sequence}`,
      });
      sequence++;
    }
  }

  return rows;
}

async function seedPortfolioFor(
  prisma: PrismaClient,
  organizationId: string,
  plans: PropertyPlan[],
): Promise<{ properties: number; buildings: number; units: number }> {
  let buildings = 0;
  let units = 0;

  for (const plan of plans) {
    const property = await prisma.property.upsert({
      where: { organizationId_name: { organizationId, name: plan.name } },
      create: {
        organizationId,
        name: plan.name,
        propertyType: plan.type,
        city: plan.city,
        county: plan.county,
        country: 'Kenya',
        description: `${plan.name} — seeded development data.`,
      },
      update: {},
      select: { id: true },
    });

    for (const buildingPlan of plan.buildings) {
      const building = await prisma.building.upsert({
        where: { propertyId_name: { propertyId: property.id, name: buildingPlan.name } },
        create: {
          organizationId,
          propertyId: property.id,
          name: buildingPlan.name,
          floors: buildingPlan.floors,
        },
        update: {},
        select: { id: true },
      });
      buildings++;

      const prefix = buildingPlan.name.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase() || 'U';
      const created = await prisma.unit.createMany({
        data: unitRows(buildingPlan.units, {
          organizationId,
          propertyId: property.id,
          buildingId: building.id,
          prefix,
        }),
        skipDuplicates: true,
      });
      units += created.count;
    }

    if (plan.looseUnits) {
      const created = await prisma.unit.createMany({
        data: unitRows(plan.looseUnits, {
          organizationId,
          propertyId: property.id,
          buildingId: null,
          prefix: 'S',
        }),
        skipDuplicates: true,
      });
      units += created.count;
    }
  }

  return { properties: plans.length, buildings, units };
}

export async function seedPortfolio(prisma: PrismaClient): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed portfolio demo data in production.');
  }

  const abc = await prisma.organization.findUnique({ where: { code: 'ABC' } });
  const xyz = await prisma.organization.findUnique({ where: { code: 'XYZ' } });
  if (!abc || !xyz) return;

  const abcTotals = await seedPortfolioFor(prisma, abc.id, ABC_PORTFOLIO);
  const xyzTotals = await seedPortfolioFor(prisma, xyz.id, XYZ_PORTFOLIO);

  console.log(
    `  ABC Properties — ${abcTotals.properties} properties, ${abcTotals.buildings} buildings, ${abcTotals.units} units`,
  );
  console.log(
    `  XYZ Estates    — ${xyzTotals.properties} properties, ${xyzTotals.buildings} buildings, ${xyzTotals.units} units`,
  );

  await seedStaffAssignments(prisma, abc.id);
}

/**
 * Partial on purpose: the caretaker is assigned to one property and the
 * accountant to two, out of three. Sign in as either and the difference is
 * immediately visible — which is the point of property scoping.
 */
async function seedStaffAssignments(prisma: PrismaClient, organizationId: string): Promise<void> {
  const properties = await prisma.property.findMany({
    where: { organizationId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  if (properties.length === 0) return;

  const owner = await prisma.user.findUnique({ where: { email: 'owner@abc.test' } });
  const caretaker = await prisma.user.findUnique({ where: { email: 'caretaker@abc.test' } });
  const accountant = await prisma.user.findUnique({ where: { email: 'accountant@abc.test' } });

  const wanted: { userId: string; propertyId: string; label: string }[] = [];
  if (caretaker && properties[0]) {
    wanted.push({ userId: caretaker.id, propertyId: properties[0].id, label: `caretaker → ${properties[0].name}` });
  }
  if (accountant) {
    for (const property of properties.slice(0, 2)) {
      wanted.push({ userId: accountant.id, propertyId: property.id, label: `accountant → ${property.name}` });
    }
  }

  for (const assignment of wanted) {
    await prisma.staffAssignment.upsert({
      where: { userId_propertyId: { userId: assignment.userId, propertyId: assignment.propertyId } },
      create: {
        organizationId,
        userId: assignment.userId,
        propertyId: assignment.propertyId,
        assignedById: owner?.id ?? null,
      },
      update: {},
    });
    console.log(`  assigned ${assignment.label}`);
  }
}

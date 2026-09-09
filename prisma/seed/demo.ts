import * as argon2 from 'argon2';
import type { PrismaClient } from '@pm/database';
import type { RoleName } from '@pm/types';
import { roleIdByName } from './permissions';

/**
 * Development and test data only.
 *
 * Two organizations exist on purpose: the isolation test suite uses them to
 * prove that ABC Properties can never see XYZ Estates' data. Phase 1 seeds
 * identity only — properties, tenants, leases and money arrive with the phases
 * that introduce those tables.
 */

const DEMO_PASSWORD = 'DemoPassword123';

interface DemoUser {
  email: string;
  fullName: string;
  phone: string;
  role: RoleName;
}

interface DemoOrg {
  name: string;
  code: string;
  city: string;
  users: DemoUser[];
}

const DEMO_ORGS: DemoOrg[] = [
  {
    name: 'ABC Properties',
    code: 'ABC',
    city: 'Nairobi',
    users: [
      { email: 'owner@abc.test', fullName: 'Amina Ochieng', phone: '+254700000001', role: 'PROPERTY_OWNER' },
      { email: 'manager@abc.test', fullName: 'Brian Kimani', phone: '+254700000002', role: 'PROPERTY_MANAGER' },
      { email: 'accountant@abc.test', fullName: 'Carol Wanjiru', phone: '+254700000003', role: 'ACCOUNTANT' },
      { email: 'caretaker@abc.test', fullName: 'Daniel Mutua', phone: '+254700000004', role: 'CARETAKER' },
    ],
  },
  {
    name: 'XYZ Estates',
    code: 'XYZ',
    city: 'Mombasa',
    users: [
      { email: 'owner@xyz.test', fullName: 'Esther Njeri', phone: '+254700000011', role: 'PROPERTY_OWNER' },
      { email: 'manager@xyz.test', fullName: 'Felix Otieno', phone: '+254700000012', role: 'PROPERTY_MANAGER' },
    ],
  },
];

export async function seedDemoData(prisma: PrismaClient): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data in production.');
  }

  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  for (const org of DEMO_ORGS) {
    const organization = await prisma.organization.upsert({
      where: { code: org.code },
      create: {
        name: org.name,
        code: org.code,
        email: `hello@${org.code.toLowerCase()}.test`,
        phone: '+254700000000',
        city: org.city,
        country: 'Kenya',
        settings: { create: {} },
      },
      update: { name: org.name, city: org.city },
    });

    for (const user of org.users) {
      const created = await prisma.user.upsert({
        where: { organizationId_email: { organizationId: organization.id, email: user.email } },
        create: {
          organizationId: organization.id,
          email: user.email,
          passwordHash,
          fullName: user.fullName,
          phone: user.phone,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
        update: { fullName: user.fullName, phone: user.phone },
      });

      const roleId = await roleIdByName(prisma, user.role);
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: created.id, roleId } },
        create: { userId: created.id, roleId, organizationId: organization.id },
        update: {},
      });
    }

    console.log(`  ${org.name} (${org.code}) — ${org.users.length} users`);
  }

  console.log(`\n  Demo sign-in password for every seeded user: ${DEMO_PASSWORD}`);
  console.log('  These accounts exist only in development and test databases.');
}

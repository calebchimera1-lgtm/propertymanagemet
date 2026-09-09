import 'dotenv/config';
import { PrismaClient } from '@pm/database';
import { seedPermissionsAndRoles } from './permissions';
import { seedDemoData } from './demo';

/**
 * Two-part seed (blueprint §7).
 *
 *   pnpm db:seed         permissions + system roles only — safe everywhere
 *   pnpm db:seed:demo    the above, plus two demo organizations (dev/test only)
 *
 * Both are idempotent: running them twice changes nothing the second time.
 */
async function main(): Promise<void> {
  const withDemo = process.argv.includes('--demo') || process.env.SEED_DEMO === 'true';
  const prisma = new PrismaClient();

  try {
    console.log('Seeding permissions and system roles...');
    await seedPermissionsAndRoles(prisma);

    if (withDemo) {
      if (process.env.NODE_ENV === 'production') {
        console.error('Refusing to seed demo data in production. Aborting.');
        process.exitCode = 1;
        return;
      }
      console.log('\nSeeding demo organizations...');
      await seedDemoData(prisma);
    } else {
      console.log('\nSkipping demo data. Pass --demo to include it.');
    }

    console.log('\nSeed complete.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});

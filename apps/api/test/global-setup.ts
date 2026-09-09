import { execSync } from 'node:child_process';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

const repoRoot = path.resolve(__dirname, '../../..');
loadEnv({ path: path.join(repoRoot, '.env') });

/**
 * Prepares the test database once per run: apply migrations, then reconcile the
 * permission catalogue and system roles.
 *
 * This is why `pnpm test:e2e` is a single command on a clean checkout — and why
 * a schema change cannot leave the suite testing yesterday's tables.
 */
export default function globalSetup(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set. See .env.example.');
  }

  const env = { ...process.env, DATABASE_URL: url };
  const run = (command: string) =>
    execSync(command, { cwd: repoRoot, env, stdio: 'inherit' });

  run('pnpm exec prisma migrate deploy --schema prisma/schema.prisma');
  run('pnpm exec tsx prisma/seed/index.ts');
}

import path from 'node:path';
import { config as loadEnv } from 'dotenv';

// The repository-root .env first, then anything the API defines for itself.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });
loadEnv();

/**
 * Integration tests run against a REAL PostgreSQL database, never a mock.
 *
 * Mocking Prisma would hide exactly what these tests exist to check: the unique
 * indexes, check constraints and transactional behaviour that the application's
 * correctness rests on.
 */
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Point it at a throwaway database — the suite truncates tables.',
  );
}
if (process.env.DATABASE_URL === testUrl) {
  // Belt and braces: the suite must never be able to wipe a development database.
  process.env.DATABASE_URL = testUrl;
}
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ??= 'test-session-secret-that-is-at-least-32-characters-long';
process.env.COOKIE_SECURE = 'false';
process.env.SWAGGER_ENABLED = 'false';
// Argon2 at production cost makes the suite crawl; the algorithm under test is
// the same, only the work factor is lowered.
process.env.ARGON2_MEMORY_COST = '8192';
process.env.ARGON2_TIME_COST = '2';
process.env.ARGON2_PARALLELISM = '1';
// Rate limits are exercised in their own spec; elsewhere they would make tests
// order-dependent and flaky.
process.env.RATE_LIMIT_LIMIT = '10000';

jest.setTimeout(30000);

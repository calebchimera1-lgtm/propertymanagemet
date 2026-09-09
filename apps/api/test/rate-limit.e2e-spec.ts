import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '@/prisma/prisma.service';
import { BASE, STRONG_PASSWORD } from './helpers/api-client';
import { createTestApp, resetDatabase } from './helpers/test-app';

/**
 * The only suite that runs with the real rate limiter enabled.
 *
 * Everything else overrides it, so this is the one place that proves the limits
 * are actually wired up rather than merely decorated.
 */
describe('Rate limiting (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ withRateLimits: true }));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('throttles repeated failed sign-in attempts', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post(`${BASE}/auth/login`)
        .send({ email: 'nobody@nowhere.test', password: 'WrongPassword123' });

    let sawTooManyRequests = false;
    for (let i = 0; i < 15; i++) {
      const response = await attempt();
      if (response.status === 429) {
        expect(response.body.code).toBe('RATE_LIMITED');
        sawTooManyRequests = true;
        break;
      }
    }

    expect(sawTooManyRequests).toBe(true);
  });

  it('throttles repeated registration attempts', async () => {
    let sawTooManyRequests = false;

    for (let i = 0; i < 10; i++) {
      const response = await request(app.getHttpServer())
        .post(`${BASE}/auth/register`)
        .send({
          organizationName: `Company ${i}`,
          fullName: 'Test Owner',
          email: `owner${i}@ratelimit.test`,
          password: STRONG_PASSWORD,
        });

      if (response.status === 429) {
        sawTooManyRequests = true;
        break;
      }
    }

    expect(sawTooManyRequests).toBe(true);
  });
});

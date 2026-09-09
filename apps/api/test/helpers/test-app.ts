import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/prisma/prisma.service';
import { TenantContextMiddleware } from '@/tenancy/tenant-context.middleware';

export interface TestContext {
  app: NestExpressApplication;
  prisma: PrismaService;
}

export interface TestAppOptions {
  /**
   * Leave the real rate limiter in place. Off by default: the auth routes cap
   * registration at 5/hour per IP, which is correct in production and would
   * make every other suite fail after its fifth organization.
   *
   * The limiter itself is covered by rate-limit.e2e-spec.ts, which turns this on.
   */
  withRateLimits?: boolean;
}

/**
 * Boots the real application graph — same guards, same pipes, same filter as
 * production. A test that bypassed the pipeline would prove nothing about it.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestContext> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (!options.withRateLimits) {
    builder.overrideProvider(ThrottlerGuard).useValue({ canActivate: () => true });
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  app.use(cookieParser());
  const tenantContext = app.get(TenantContextMiddleware);
  app.use(tenantContext.use.bind(tenantContext));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false, value: false },
    }),
  );

  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

/**
 * Wipes tenant data between specs while leaving the seeded permission
 * catalogue and system roles intact.
 *
 * Deliberately DELETE in foreign-key order rather than TRUNCATE ... CASCADE:
 * Role references Organization, so a cascade would silently take the system
 * roles with it and every subsequent registration would fail.
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$transaction([
    prisma.$executeRawUnsafe('DELETE FROM "AuditLog"'),
    prisma.$executeRawUnsafe('DELETE FROM "Session"'),
    prisma.$executeRawUnsafe('DELETE FROM "PasswordResetToken"'),
    prisma.$executeRawUnsafe('DELETE FROM "EmailVerificationToken"'),
    prisma.$executeRawUnsafe('DELETE FROM "UserRole"'),
    prisma.$executeRawUnsafe('DELETE FROM "Settings"'),
    prisma.$executeRawUnsafe('DELETE FROM "User"'),
    // Per-organization custom roles only; system roles have a null organizationId.
    prisma.$executeRawUnsafe('DELETE FROM "Role" WHERE "organizationId" IS NOT NULL'),
    prisma.$executeRawUnsafe('DELETE FROM "Organization"'),
  ]);

  const systemRoles = await prisma.role.count({ where: { organizationId: null } });
  if (systemRoles === 0) {
    throw new Error(
      'The test database has no system roles. Run "pnpm db:test:prepare" before the suite.',
    );
  }
}

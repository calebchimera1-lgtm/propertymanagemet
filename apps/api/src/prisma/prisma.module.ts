import { Global, Inject, Module } from '@nestjs/common';
import { TenantContextService } from '@/tenancy/tenant-context.service';
import { PrismaService } from './prisma.service';
import { createTenantScopedClient, type ScopedPrismaClient } from './tenant-scope.extension';

/** DI token for the tenant-scoped client. */
export const SCOPED_PRISMA = Symbol('SCOPED_PRISMA');

/** `@InjectScopedPrisma() private readonly db: ScopedPrismaClient` */
export const InjectScopedPrisma = () => Inject(SCOPED_PRISMA);

@Global()
@Module({
  providers: [
    PrismaService,
    {
      provide: SCOPED_PRISMA,
      inject: [PrismaService, TenantContextService],
      useFactory: (prisma: PrismaService, tenant: TenantContextService): ScopedPrismaClient =>
        createTenantScopedClient(prisma, tenant),
    },
  ],
  exports: [PrismaService, SCOPED_PRISMA],
})
export class PrismaModule {}

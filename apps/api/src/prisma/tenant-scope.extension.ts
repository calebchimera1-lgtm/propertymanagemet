import { Logger } from '@nestjs/common';
import type { TenantContextService } from '@/tenancy/tenant-context.service';
import type { PrismaService } from './prisma.service';

/**
 * Models whose rows belong to exactly one organization.
 *
 * Adding a tenant-owned model to the schema without adding it here is the one
 * mistake this file cannot catch for you — which is why `tenant-scope.spec.ts`
 * asserts that every model with an `organizationId` field appears in this set.
 */
export const TENANT_SCOPED_MODELS = new Set<string>([
  'User',
  'Session',
  'UserRole',
  'Settings',
  'AuditLog',
  'Property',
  'Building',
  'Unit',
  'StaffAssignment',
  'Tenant',
  'Lease',
]);

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

type AnyArgs = Record<string, unknown>;

function mergeWhere(args: AnyArgs, organizationId: string): AnyArgs {
  const existing = (args.where as AnyArgs | undefined) ?? {};
  return { ...args, where: { ...existing, organizationId } };
}

function stampData(data: unknown, organizationId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((row) => ({ ...(row as AnyArgs), organizationId }));
  }
  return { ...(data as AnyArgs), organizationId };
}

/**
 * Layer 2 of the multi-tenant model (blueprint §9).
 *
 * Every read, write and delete on a tenant-scoped model is rewritten to carry
 * the organization id from the request's tenant context. A query with no
 * context throws rather than running unscoped: for tenant data, failing loudly
 * is always better than answering broadly.
 *
 * This layer is not the only defence. Services still assert ownership, and from
 * Phase 2 the composite foreign keys make a cross-organization row reference
 * impossible in the database itself.
 */
export function createTenantScopedClient(prisma: PrismaService, tenant: TenantContextService) {
  const logger = new Logger('TenantScope');

  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          // Throws TenantContextMissingError when there is no request context.
          const { organizationId } = tenant.getOrThrow();
          let scopedArgs: AnyArgs = (args ?? {}) as AnyArgs;

          if (WHERE_OPERATIONS.has(operation)) {
            scopedArgs = mergeWhere(scopedArgs, organizationId);
          }

          if (operation === 'create' || operation === 'createMany' || operation === 'createManyAndReturn') {
            scopedArgs = { ...scopedArgs, data: stampData(scopedArgs.data, organizationId) };
          }

          if (operation === 'upsert') {
            scopedArgs = mergeWhere(scopedArgs, organizationId);
            scopedArgs = { ...scopedArgs, create: stampData(scopedArgs.create, organizationId) };
          }

          if (process.env.NODE_ENV === 'development') {
            logger.debug(`${model}.${operation} scoped to organization ${organizationId}`);
          }

          return query(scopedArgs);
        },
      },
    },
  });
}

export type ScopedPrismaClient = ReturnType<typeof createTenantScopedClient>;

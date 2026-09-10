import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pm/database';
import { paginated } from '@/common/dto/pagination.dto';
import { NotFoundError } from '@/common/errors/domain.errors';
import { serialiseMoney } from '@/common/money/money';
import { parseDateOnly } from '@/modules/leases/lease-dates';
import { PrismaService } from '@/prisma/prisma.service';
import { InjectScopedPrisma } from '@/prisma/prisma.module';
import type { ScopedPrismaClient } from '@/prisma/tenant-scope.extension';
import { PropertyScopeService } from '@/tenancy/property-scope.service';
import { TenantContextService } from '@/tenancy/tenant-context.service';
import type { ListReceiptsQueryDto } from './dto/receipt.dto';

const RECEIPT_SELECT = {
  id: true,
  receiptNumber: true,
  paymentId: true,
  tenantId: true,
  propertyId: true,
  unitId: true,
  amount: true,
  paymentMethod: true,
  reference: true,
  paymentDate: true,
  periodLabel: true,
  voidedAt: true,
  createdAt: true,
  tenant: { select: { id: true, fullName: true, phone: true, email: true } },
  unit: { select: { id: true, unitNumber: true } },
  property: { select: { id: true, name: true } },
} satisfies Prisma.ReceiptSelect;

type ReceiptRow = Prisma.ReceiptGetPayload<{ select: typeof RECEIPT_SELECT }>;

@Injectable()
export class ReceiptsService {
  constructor(
    @InjectScopedPrisma() private readonly db: ScopedPrismaClient,
    private readonly prisma: PrismaService,
    private readonly scope: PropertyScopeService,
    private readonly tenant: TenantContextService,
  ) {}

  private serialise(receipt: ReceiptRow) {
    return { ...receipt, amount: serialiseMoney(receipt.amount) };
  }

  async list(query: ListReceiptsQueryDto) {
    if (query.propertyId) this.scope.assertProperty(query.propertyId, 'Receipt');

    const where: Prisma.ReceiptWhereInput = {
      ...this.scope.where(),
      ...(query.propertyId ? { propertyId: query.propertyId } : {}),
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      // Voided receipts stay in the book — their numbers are never reused — but
      // they are out of the default view so a register can be added up.
      ...(query.includeVoided === 'true' ? {} : { voidedAt: null }),
      ...(query.dateFrom || query.dateTo
        ? {
            paymentDate: {
              ...(query.dateFrom ? { gte: parseDateOnly(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: parseDateOnly(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { receiptNumber: { contains: query.search, mode: 'insensitive' } },
              { reference: { contains: query.search, mode: 'insensitive' } },
              { tenant: { fullName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.receipt.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: query.sortOrder },
        select: RECEIPT_SELECT,
      }),
      this.db.receipt.count({ where }),
    ]);

    return paginated(rows.map((row) => this.serialise(row)), total, query.page, query.limit);
  }

  /**
   * Everything a printed receipt needs, including the issuing organization's
   * own details — a receipt with no letterhead is not a receipt.
   */
  async findOne(id: string) {
    const receipt = await this.db.receipt.findFirst({
      where: { id, ...this.scope.where() },
      select: RECEIPT_SELECT,
    });
    if (!receipt) throw new NotFoundError('Receipt');

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: this.tenant.organizationId },
      select: {
        name: true,
        code: true,
        email: true,
        phone: true,
        addressLine: true,
        city: true,
        currency: true,
      },
    });

    return { ...this.serialise(receipt), organization };
  }
}

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pm/database';
import { paginated } from '@/common/dto/pagination.dto';
import { NotFoundError, ValidationError } from '@/common/errors/domain.errors';
import { serialiseMoney, toDecimal } from '@/common/money/money';
import { AUDIT_ACTIONS, AuditLogService } from '@/modules/audit-logs/audit-log.service';
import { parseDateOnly, todayUtc } from '@/modules/leases/lease-dates';
import { InjectScopedPrisma } from '@/prisma/prisma.module';
import type { ScopedPrismaClient } from '@/prisma/tenant-scope.extension';
import { PropertyScopeService } from '@/tenancy/property-scope.service';
import { TenantContextService } from '@/tenancy/tenant-context.service';
import type {
  CreateExpenseDto,
  ExpenseSummaryQueryDto,
  ListExpensesQueryDto,
  UpdateExpenseDto,
} from './dto/expense.dto';

const EXPENSE_SELECT = {
  id: true,
  propertyId: true,
  buildingId: true,
  unitId: true,
  category: true,
  description: true,
  amount: true,
  expenseDate: true,
  paymentMethod: true,
  vendor: true,
  reference: true,
  createdAt: true,
  updatedAt: true,
  property: { select: { id: true, name: true } },
  building: { select: { id: true, name: true } },
  unit: { select: { id: true, unitNumber: true } },
} satisfies Prisma.ExpenseSelect;

type ExpenseRow = Prisma.ExpenseGetPayload<{ select: typeof EXPENSE_SELECT }>;

@Injectable()
export class ExpensesService {
  constructor(
    @InjectScopedPrisma() private readonly db: ScopedPrismaClient,
    private readonly scope: PropertyScopeService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditLogService,
  ) {}

  private serialise(expense: ExpenseRow) {
    return { ...expense, amount: serialiseMoney(expense.amount) };
  }

  private dateFilter(dateFrom?: string, dateTo?: string) {
    if (!dateFrom && !dateTo) return {};
    return {
      expenseDate: {
        ...(dateFrom ? { gte: parseDateOnly(dateFrom) } : {}),
        ...(dateTo ? { lte: parseDateOnly(dateTo) } : {}),
      },
    };
  }

  async list(query: ListExpensesQueryDto) {
    if (query.propertyId) this.scope.assertProperty(query.propertyId, 'Expense');

    const where: Prisma.ExpenseWhereInput = {
      ...this.scope.where(),
      ...(query.category ? { category: query.category } : {}),
      ...(query.propertyId ? { propertyId: query.propertyId } : {}),
      ...this.dateFilter(query.dateFrom, query.dateTo),
      ...(query.search
        ? {
            OR: [
              { description: { contains: query.search, mode: 'insensitive' } },
              { vendor: { contains: query.search, mode: 'insensitive' } },
              { reference: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total, aggregate] = await Promise.all([
      this.db.expense.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { [query.sortBy ?? 'expenseDate']: query.sortOrder },
        select: EXPENSE_SELECT,
      }),
      this.db.expense.count({ where }),
      this.db.expense.aggregate({ where, _sum: { amount: true } }),
    ]);

    return {
      ...paginated(rows.map((row) => this.serialise(row)), total, query.page, query.limit),
      // The total for the current filter, not the page — a page total would be
      // a number that changes when you click "next".
      totalAmount: serialiseMoney(aggregate._sum.amount),
    };
  }

  async findOne(id: string) {
    const expense = await this.db.expense.findFirst({
      where: { id, ...this.scope.where() },
      select: EXPENSE_SELECT,
    });
    if (!expense) throw new NotFoundError('Expense');
    return this.serialise(expense);
  }

  /** Totals by category, for the expense breakdown and the P&L in Phase 6. */
  async summary(query: ExpenseSummaryQueryDto) {
    if (query.propertyId) this.scope.assertProperty(query.propertyId, 'Expense');

    const where: Prisma.ExpenseWhereInput = {
      ...this.scope.where(),
      ...(query.propertyId ? { propertyId: query.propertyId } : {}),
      ...this.dateFilter(query.dateFrom, query.dateTo),
    };

    const [groups, aggregate] = await Promise.all([
      this.db.expense.groupBy({
        by: ['category'],
        where,
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.db.expense.aggregate({ where, _sum: { amount: true }, _count: { _all: true } }),
    ]);

    return {
      total: serialiseMoney(aggregate._sum.amount),
      count: aggregate._count._all,
      byCategory: groups
        .map((group) => ({
          category: group.category,
          total: serialiseMoney(group._sum.amount),
          count: group._count._all,
        }))
        .sort((a, b) => Number(b.total) - Number(a.total)),
    };
  }

  async create(dto: CreateExpenseDto) {
    const auth = this.tenant.getOrThrow();
    this.scope.assertProperty(dto.propertyId, 'Property');

    const property = await this.db.property.findFirst({
      where: { id: dto.propertyId },
      select: { id: true },
    });
    if (!property) throw new NotFoundError('Property');

    await this.assertBelongsToProperty(dto.propertyId, dto.buildingId, dto.unitId);

    const expenseDate = parseDateOnly(dto.expenseDate);
    if (Number.isNaN(expenseDate.getTime())) {
      throw new ValidationError('The expense date is not a valid date.', [
        { field: 'expenseDate', message: 'Enter a date such as 2026-09-05.' },
      ]);
    }
    if (expenseDate > todayUtc()) {
      throw new ValidationError('An expense cannot be dated in the future.', [
        { field: 'expenseDate', message: 'Choose today or an earlier date.' },
      ]);
    }

    const expense = await this.db.expense.create({
      data: {
        organizationId: auth.organizationId,
        propertyId: dto.propertyId,
        buildingId: dto.buildingId ?? null,
        unitId: dto.unitId ?? null,
        category: dto.category,
        description: dto.description,
        amount: toDecimal(dto.amount),
        expenseDate,
        paymentMethod: dto.paymentMethod ?? null,
        vendor: dto.vendor ?? null,
        reference: dto.reference ?? null,
        createdById: auth.userId,
      },
      select: EXPENSE_SELECT,
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.EXPENSE_CREATED,
      entityType: 'Expense',
      entityId: expense.id,
      metadata: {
        amount: serialiseMoney(expense.amount),
        category: expense.category,
        propertyId: dto.propertyId,
      },
    });

    return this.serialise(expense);
  }

  async update(id: string, dto: UpdateExpenseDto) {
    const auth = this.tenant.getOrThrow();
    const current = await this.findOne(id);

    if (dto.buildingId !== undefined || dto.unitId !== undefined) {
      await this.assertBelongsToProperty(
        current.propertyId,
        dto.buildingId ?? current.buildingId ?? undefined,
        dto.unitId ?? current.unitId ?? undefined,
      );
    }

    await this.db.expense.update({
      where: { id },
      data: {
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.amount !== undefined ? { amount: toDecimal(dto.amount) } : {}),
        ...(dto.expenseDate !== undefined ? { expenseDate: parseDateOnly(dto.expenseDate) } : {}),
        ...(dto.paymentMethod !== undefined ? { paymentMethod: dto.paymentMethod } : {}),
        ...(dto.vendor !== undefined ? { vendor: dto.vendor } : {}),
        ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
        ...(dto.buildingId !== undefined ? { buildingId: dto.buildingId || null } : {}),
        ...(dto.unitId !== undefined ? { unitId: dto.unitId || null } : {}),
      },
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.EXPENSE_UPDATED,
      entityType: 'Expense',
      entityId: id,
      metadata: { changed: Object.keys(dto) },
    });

    return this.findOne(id);
  }

  /**
   * Expenses are the one financial record that can be deleted.
   *
   * Unlike a payment, an expense is a statement about the organization's own
   * spending rather than a receipt given to somebody else, so a mistyped one is
   * corrected rather than reversed. The deletion is audited with its amount.
   */
  async remove(id: string): Promise<void> {
    const auth = this.tenant.getOrThrow();
    const expense = await this.findOne(id);

    await this.db.expense.delete({ where: { id } });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.EXPENSE_DELETED,
      entityType: 'Expense',
      entityId: id,
      metadata: {
        amount: expense.amount,
        category: expense.category,
        description: expense.description,
      },
    });
  }

  /** A building or unit attached to an expense must sit under its property. */
  private async assertBelongsToProperty(
    propertyId: string,
    buildingId?: string,
    unitId?: string,
  ): Promise<void> {
    if (buildingId) {
      const building = await this.db.building.findFirst({
        where: { id: buildingId },
        select: { propertyId: true },
      });
      if (!building) throw new NotFoundError('Building');
      if (building.propertyId !== propertyId) {
        throw new ValidationError('That building belongs to a different property.', [
          { field: 'buildingId', message: 'Choose a building inside the selected property.' },
        ]);
      }
    }

    if (unitId) {
      const unit = await this.db.unit.findFirst({
        where: { id: unitId },
        select: { propertyId: true },
      });
      if (!unit) throw new NotFoundError('Unit');
      if (unit.propertyId !== propertyId) {
        throw new ValidationError('That unit belongs to a different property.', [
          { field: 'unitId', message: 'Choose a unit inside the selected property.' },
        ]);
      }
    }
  }
}

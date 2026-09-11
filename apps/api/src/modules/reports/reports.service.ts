import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@/common/errors/domain.errors';
import { InjectScopedPrisma } from '@/prisma/prisma.module';
import type { ScopedPrismaClient } from '@/prisma/tenant-scope.extension';
import { PropertyScopeService } from '@/tenancy/property-scope.service';
import { TenantContextService } from '@/tenancy/tenant-context.service';
import type { ReportFiltersDto, ReportKey } from './dto/report.dto';
import type { ExportMeta } from './exporters/csv.exporter';
import type { ReportContext, ReportResult, ReportStrategy } from './report.types';
import {
  ExpenseReport,
  IncomeReport,
  OutstandingRentReport,
  ProfitLossReport,
  RentCollectionReport,
} from './strategies/financial.strategies';
import {
  LeaseExpiryReport,
  MaintenanceReport,
  OccupancyReport,
  TenantReport,
} from './strategies/portfolio.strategies';

const DEFAULT_LIMIT = 50;

/**
 * Runs a report.
 *
 * Every strategy gets the same context, built here — which is what makes
 * "a report is not a back door" true rather than a hope. The organization and
 * property scope are resolved once, from the session, and no strategy is
 * trusted to remember to apply them.
 */
@Injectable()
export class ReportsService {
  private readonly registry = new Map<string, ReportStrategy>();

  constructor(
    @InjectScopedPrisma() private readonly db: ScopedPrismaClient,
    private readonly scope: PropertyScopeService,
    private readonly tenant: TenantContextService,
    rentCollection: RentCollectionReport,
    outstandingRent: OutstandingRentReport,
    tenants: TenantReport,
    occupancy: OccupancyReport,
    expenses: ExpenseReport,
    income: IncomeReport,
    profitLoss: ProfitLossReport,
    maintenance: MaintenanceReport,
    leaseExpiry: LeaseExpiryReport,
  ) {
    for (const strategy of [
      rentCollection,
      outstandingRent,
      tenants,
      occupancy,
      expenses,
      income,
      profitLoss,
      maintenance,
      leaseExpiry,
    ]) {
      this.registry.set(strategy.key, strategy);
    }
  }

  /** The report launcher: what can be run, and which filters each one honours. */
  catalogue() {
    return [...this.registry.values()].map((strategy) => ({
      key: strategy.key,
      title: strategy.title,
      description: strategy.description,
      filters: strategy.filters,
    }));
  }

  private strategyOrThrow(key: string): ReportStrategy {
    const strategy = this.registry.get(key);
    if (!strategy) throw new NotFoundError('Report');
    return strategy;
  }

  private async buildContext(filters: ReportFiltersDto): Promise<ReportContext> {
    const auth = this.tenant.getOrThrow();

    /*
     * A filter naming a property the caller cannot reach is a 404, exactly as
     * it would be on the property itself.
     *
     * Both halves matter. `assertProperty` catches a scoped user reaching
     * outside their assignments; the existence check catches an unrestricted
     * owner naming another organization's property, which would otherwise
     * return an empty 200 — no leak, but a different answer from every other
     * endpoint for the same mistake.
     */
    if (filters.propertyId) {
      this.scope.assertProperty(filters.propertyId);
      const exists = await this.db.property.count({ where: { id: filters.propertyId } });
      if (exists === 0) throw new NotFoundError('Property');
    }

    const propertyIds = this.scope.propertyIds;
    const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, 500);
    const page = Math.max(filters.page ?? 1, 1);

    return {
      db: this.db,
      organizationId: auth.organizationId,
      propertyIds,
      scopeWhere: propertyIds === null ? {} : { propertyId: { in: propertyIds } },
      filters,
      skip: (page - 1) * limit,
      take: limit,
    };
  }

  async run(key: ReportKey | string, filters: ReportFiltersDto): Promise<ReportResult & {
    report: { key: string; title: string; description: string };
    scoped: boolean;
  }> {
    const strategy = this.strategyOrThrow(key);
    const context = await this.buildContext(filters);

    /*
     * A property-scoped caller with no assignments gets an empty report, not
     * the organization's.
     *
     * Every strategy would produce this anyway via `propertyId IN ()`, but
     * short-circuiting says the intent out loud and costs nothing.
     */
    if (context.propertyIds !== null && context.propertyIds.length === 0) {
      return {
        report: { key: strategy.key, title: strategy.title, description: strategy.description },
        columns: [],
        rows: [],
        totals: {},
        meta: { total: 0, page: 1, limit: context.take },
        scoped: true,
      };
    }

    const result = await strategy.run(context);
    return {
      report: { key: strategy.key, title: strategy.title, description: strategy.description },
      ...result,
      scoped: this.scope.isRestricted,
    };
  }

  /**
   * Everything an export needs to state what it covers.
   *
   * Built from the same filters the query used, so the header on the page can
   * never describe a different query than the one that produced the rows.
   */
  async exportMeta(key: string, filters: ReportFiltersDto): Promise<ExportMeta> {
    const strategy = this.strategyOrThrow(key);
    const auth = this.tenant.getOrThrow();

    const organization = await this.db.organization.findUniqueOrThrow({
      where: { id: auth.organizationId },
      select: { name: true },
    });

    const lines: string[] = [];
    if (filters.period) lines.push(`Period: ${filters.period}`);
    if (filters.dateFrom || filters.dateTo) {
      lines.push(`Dates: ${filters.dateFrom ?? 'any'} to ${filters.dateTo ?? 'any'}`);
    }
    if (filters.propertyId) {
      const property = await this.db.property.findFirst({
        where: { id: filters.propertyId },
        select: { name: true },
      });
      lines.push(`Property: ${property?.name ?? filters.propertyId}`);
    }
    if (filters.status) lines.push(`Status: ${filters.status}`);
    if (filters.category) lines.push(`Category: ${filters.category}`);
    if (filters.paymentMethod) lines.push(`Method: ${filters.paymentMethod}`);
    if (lines.length === 0) lines.push('Filters: none — everything you have access to');

    // Said on the page, because a scoped export covers less than the
    // organization and the person reading it needs to know that.
    if (this.scope.isRestricted) {
      lines.push('Scope: limited to the properties assigned to you');
    }

    return {
      title: strategy.title,
      filters: lines,
      organizationName: organization.name,
      generatedAt: new Date(),
    };
  }

  /**
   * The rows for an export: the same strategy, but every matching row rather
   * than one page. Capped, because an unbounded export is a way to ask the
   * server to build a gigabyte in memory.
   */
  async runForExport(key: string, filters: ReportFiltersDto): Promise<ReportResult> {
    const strategy = this.strategyOrThrow(key);
    const context = await this.buildContext({ ...filters, page: 1, limit: 500 });

    if (context.propertyIds !== null && context.propertyIds.length === 0) {
      return { columns: [], rows: [], totals: {}, meta: { total: 0, page: 1, limit: 0 } };
    }

    const EXPORT_CAP = 10_000;
    const collected: ReportResult['rows'] = [];
    let first: ReportResult | null = null;

    for (let page = 1; collected.length < EXPORT_CAP; page++) {
      const result = await strategy.run({
        ...context,
        filters: { ...filters, page, limit: 500 },
        skip: (page - 1) * 500,
        take: 500,
      });
      first ??= result;
      collected.push(...result.rows);

      if (result.rows.length < 500 || collected.length >= result.meta.total) break;
    }

    return {
      columns: first?.columns ?? [],
      rows: collected,
      totals: first?.totals ?? {},
      meta: first?.meta ?? { total: collected.length, page: 1, limit: collected.length },
    };
  }
}

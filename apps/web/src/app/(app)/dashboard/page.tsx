'use client';

import { BarChart3 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { FilterSelect } from '@/components/data-table/toolbar';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/use-session';
import { currentPeriod, periodLabel, recentPeriods } from '@/features/finance/labels';
import {
  CollectionTrendChart,
  ExpectedVsCollectedChart,
  ExpensesByCategoryChart,
  NetIncomeChart,
  OccupancyTrendChart,
  PropertyPerformanceChart,
} from '@/features/insights/components/charts';
import { StatTile } from '@/features/insights/components/stat-tiles';
import {
  ExpiringLeasesPanel,
  OpenMaintenancePanel,
  OverdueRentPanel,
  RecentPaymentsPanel,
} from '@/features/insights/components/worklist-panels';
import { useDashboardCharts, useDashboardSummary, useWorklists } from '@/features/insights/queries';
import { useProperties } from '@/features/portfolio/queries';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/utils';

export default function DashboardPage() {
  const { me, can } = useSession();
  const currency = me?.organization.currency ?? 'KES';

  const [period, setPeriod] = useState(currentPeriod());
  const [propertyId, setPropertyId] = useState<string | undefined>(undefined);

  const canSeeReports = can('reports.view');
  const summary = useDashboardSummary({ period, propertyId });
  const charts = useDashboardCharts({ months: 12, propertyId });
  const worklists = useWorklists();
  const properties = useProperties({ limit: 100, sortBy: 'name', sortOrder: 'asc' });

  if (!me) return <CardSkeleton count={4} />;

  /*
   * A role without reports.view — a caretaker — has no dashboard to show.
   *
   * Rendering an empty one full of zeroes would read as "the portfolio is
   * empty" rather than "this is not yours to see", which is a different and
   * alarming thing to tell someone.
   */
  if (!canSeeReports) {
    return (
      <>
        <PageHeader
          title={`Welcome, ${me.user.fullName.split(' ')[0]}`}
          description={`${me.organization.name} · ${me.organization.currency} · ${me.organization.timezone}`}
        />
        <EmptyState
          icon={BarChart3}
          title="The dashboard is not part of your role"
          description="Your role covers the day-to-day work rather than the numbers. Maintenance, tenants and documents are in the sidebar."
          action={
            <Button asChild>
              <Link href="/maintenance">Go to maintenance</Link>
            </Button>
          }
        />
      </>
    );
  }

  if (summary.isError) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <ErrorState
          description={
            summary.error instanceof ApiError
              ? summary.error.message
              : 'The dashboard could not be loaded.'
          }
          onRetry={() => void summary.refetch()}
        />
      </>
    );
  }

  const money = summary.data?.money;
  const portfolio = summary.data?.portfolio;
  const months = charts.data?.months ?? [];
  const emptyScope = Boolean(summary.data?.scoped && portfolio && portfolio.properties === 0);

  return (
    <>
      <PageHeader
        title={`Welcome, ${me.user.fullName.split(' ')[0]}`}
        description={`${me.organization.name} · every figure below is read from the database, not estimated.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <FilterSelect
              label="Period"
              value={period}
              onChange={(value) => setPeriod(value ?? currentPeriod())}
              options={recentPeriods(12).map((value) => ({ value, label: periodLabel(value) }))}
              allLabel={periodLabel(currentPeriod())}
            />
            <FilterSelect
              label="Property"
              value={propertyId}
              onChange={setPropertyId}
              options={(properties.data?.data ?? []).map((property) => ({
                value: property.id,
                label: property.name,
              }))}
              allLabel="All properties"
            />
          </div>
        }
      />

      {!me.user.emailVerified ? (
        <Alert variant="warning">
          <AlertDescription>
            Your email address is not confirmed yet. Email delivery is not enabled in this version —
            the confirmation link is written to the API server log.
          </AlertDescription>
        </Alert>
      ) : null}

      {summary.data?.scoped && !emptyScope ? (
        <Alert variant="info">
          <AlertDescription>
            These figures cover the properties assigned to you, not the whole organization.
          </AlertDescription>
        </Alert>
      ) : null}

      {emptyScope ? (
        <EmptyState
          icon={BarChart3}
          title="No properties are assigned to you yet"
          description="Once someone assigns you a property, its numbers appear here. These are not zeroes in an empty portfolio — it is an empty scope."
        />
      ) : (
        <>
          {summary.isLoading || !money || !portfolio ? (
            <CardSkeleton count={4} />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile
                  label={`Charged · ${periodLabel(period)}`}
                  value={formatMoney(money.expected, currency)}
                  hint={`${money.chargeCount} charge${money.chargeCount === 1 ? '' : 's'}`}
                />
                <StatTile
                  label="Collected"
                  value={formatMoney(money.collected, currency)}
                  hint={`${money.collectionRate}% of what was charged`}
                  tone="positive"
                />
                <StatTile
                  label="Outstanding"
                  value={formatMoney(money.outstanding, currency)}
                  hint={
                    Number(money.overdue) > 0 ? (
                      <span className="text-destructive">
                        {formatMoney(money.overdue, currency)} overdue
                      </span>
                    ) : (
                      'Nothing past its due date'
                    )
                  }
                />
                <StatTile
                  label="Net income"
                  value={formatMoney(money.netIncome, currency)}
                  hint={`after ${formatMoney(money.expenses, currency)} of expenses`}
                  tone={Number(money.netIncome) < 0 ? 'negative' : 'positive'}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile
                  label="Occupancy"
                  value={`${portfolio.occupancyRate}%`}
                  delta={portfolio.occupancyDelta}
                  hint={`${portfolio.units.occupied} of ${portfolio.units.total} units`}
                />
                <StatTile
                  label="Vacant units"
                  value={String(portfolio.units.vacant)}
                  hint={
                    portfolio.units.maintenance > 0
                      ? `${portfolio.units.maintenance} more out of service`
                      : 'Ready to let'
                  }
                />
                <StatTile
                  label="Properties"
                  value={String(portfolio.properties)}
                  hint={`${portfolio.buildings} building${portfolio.buildings === 1 ? '' : 's'}`}
                />
                <StatTile
                  label="Expenses"
                  value={formatMoney(money.expenses, currency)}
                  hint={`${money.expenseCount} recorded this period`}
                />
              </div>
            </>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <ExpectedVsCollectedChart months={months} currency={currency} loading={charts.isLoading} />
            <CollectionTrendChart months={months} currency={currency} loading={charts.isLoading} />
            <NetIncomeChart months={months} currency={currency} loading={charts.isLoading} />
            <OccupancyTrendChart months={months} loading={charts.isLoading} />
            <ExpensesByCategoryChart
              categories={charts.data?.expensesByCategory ?? []}
              currency={currency}
              loading={charts.isLoading}
            />
            <PropertyPerformanceChart
              properties={charts.data?.propertyPerformance ?? []}
              currency={currency}
              loading={charts.isLoading}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <OverdueRentPanel
              rows={worklists.data?.overdueRent ?? []}
              currency={currency}
              loading={worklists.isLoading}
            />
            <ExpiringLeasesPanel
              rows={worklists.data?.expiringLeases ?? []}
              currency={currency}
              loading={worklists.isLoading}
            />
            <OpenMaintenancePanel
              rows={worklists.data?.openMaintenance ?? []}
              loading={worklists.isLoading}
            />
            <RecentPaymentsPanel
              rows={worklists.data?.recentPayments ?? []}
              currency={currency}
              loading={worklists.isLoading}
            />
          </div>
        </>
      )}
    </>
  );
}

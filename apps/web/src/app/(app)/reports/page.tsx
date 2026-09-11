'use client';

import {
  BarChart3,
  CalendarClock,
  Coins,
  FileBarChart,
  Home,
  Receipt,
  TrendingUp,
  Users,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { CardSkeleton, ErrorState } from '@/components/states';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useReportCatalogue } from '@/features/insights/queries';
import { ApiError } from '@/lib/api-client';

/** One icon per report, so the grid is scannable rather than nine identical cards. */
const ICONS: Record<string, LucideIcon> = {
  'rent-collection': Coins,
  'outstanding-rent': Receipt,
  tenants: Users,
  occupancy: Home,
  expenses: FileBarChart,
  income: TrendingUp,
  'profit-loss': BarChart3,
  maintenance: Wrench,
  'lease-expiry': CalendarClock,
};

export default function ReportsPage() {
  const catalogue = useReportCatalogue();

  return (
    <>
      <PageHeader
        title="Reports"
        description="Every report reads the live database and covers exactly what you have access to. Nothing here is a cached snapshot."
      />

      {catalogue.isLoading ? (
        <CardSkeleton count={6} />
      ) : catalogue.isError ? (
        <ErrorState
          description={
            catalogue.error instanceof ApiError
              ? catalogue.error.message
              : 'The report list could not be loaded.'
          }
          onRetry={() => void catalogue.refetch()}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(catalogue.data ?? []).map((report) => {
            const Icon = ICONS[report.key] ?? FileBarChart;
            return (
              <Link key={report.key} href={`/reports/${report.key}`} className="group">
                <Card className="h-full transition-colors group-hover:border-primary/40 group-hover:bg-muted/30">
                  <CardHeader>
                    <div className="mb-2 w-fit rounded-md bg-primary/10 p-2">
                      <Icon className="h-5 w-5 text-primary" aria-hidden />
                    </div>
                    <CardTitle className="text-base">{report.title}</CardTitle>
                    <CardDescription>{report.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    {report.filters.length} filter{report.filters.length === 1 ? '' : 's'} available
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

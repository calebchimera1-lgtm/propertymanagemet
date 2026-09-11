'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type * as React from 'react';
import { formatMoney } from '@/lib/utils';
import { EXPENSE_CATEGORY_LABELS } from '@/features/finance/labels';
import type { ExpenseCategory } from '@/features/finance/types';
import { ChartShell, ChartTable, ChartTableRow } from './chart-shell';
import type { DashboardCharts } from '../types';

/**
 * The dashboard charts.
 *
 * Conventions that hold across all of them:
 *
 *   - **Colour follows the entity, never its rank.** Collected is always slot 1,
 *     expenses always slot 2. A chart that repainted its series when a filter
 *     changed would make two screens disagree about what blue means.
 *   - **One axis.** Never two y-scales on one chart — two measures of different
 *     magnitude get two charts, not two axes and a reader who has to guess.
 *   - **Text wears text tokens.** Values and labels stay in muted ink; the
 *     coloured mark beside them carries the identity.
 *   - Grid and axes are recessive hairlines; marks are thin; every chart has a
 *     hover layer, because a chart you cannot interrogate is a picture.
 */

const AXIS = {
  stroke: 'var(--viz-axis)',
  tick: { fill: 'var(--viz-muted)', fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

/** "2026-09" → "Sep". Axis ticks need the month, not the year, twelve times over. */
function shortMonth(period: string): string {
  const [year, month] = period.split('-');
  if (!year || !month) return period;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(date);
}

function fullMonth(period: string): string {
  const [year, month] = period.split('-');
  if (!year || !month) return period;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** Compact axis labels: 1.2M rather than 1,200,000 twelve times down the side. */
function compact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(Math.round(value));
}

interface TooltipPayload {
  name?: string;
  value?: number;
  color?: string;
  dataKey?: string | number;
}

/**
 * One tooltip for every chart.
 *
 * Recharts' default renders raw numbers on a white box that ignores the theme.
 * This one formats money properly and follows the card surface.
 */
function ChartTooltip({
  active,
  payload,
  label,
  currency,
  formatValue,
  labelFormatter = fullMonth,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
  currency: string;
  formatValue?: (value: number) => string;
  labelFormatter?: (label: string) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-popover-foreground">
        {label ? labelFormatter(label) : ''}
      </div>
      <ul className="space-y-0.5">
        {payload.map((entry) => (
          <li key={String(entry.dataKey)} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-[1px]"
              style={{ background: entry.color }}
              aria-hidden
            />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto font-medium tabular-nums text-popover-foreground">
              {formatValue
                ? formatValue(entry.value ?? 0)
                : formatMoney(entry.value ?? 0, currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const legendStyle = { fontSize: 12, paddingTop: 8 } as const;

/**
 * Recharts paints legend labels in the series colour by default.
 *
 * That breaks the rule that text wears text tokens: the coloured swatch beside
 * the label already carries the identity, and colouring the words as well makes
 * low-contrast series text — three of these hues sit under 3:1 on the light
 * card. The swatch keeps its colour; the label goes to muted ink.
 */
function legendLabel(value: string): React.ReactNode {
  return <span className="text-muted-foreground">{value}</span>;
}

/** Trend over time, one series — so no legend: the title names it. */
export function CollectionTrendChart({
  months,
  currency,
  loading,
}: {
  months: DashboardCharts['months'];
  currency: string;
  loading?: boolean;
}) {
  const data = months.map((month) => ({
    period: month.period,
    collected: Number(month.collected),
  }));
  const empty = data.every((point) => point.collected === 0);

  return (
    <ChartShell
      title="Rent collected"
      description="What actually came in, month by month."
      loading={loading}
      empty={empty}
      emptyMessage="No payments recorded in this window."
      table={
        <ChartTable head={['Month', 'Collected']}>
          {months.map((month) => (
            <ChartTableRow
              key={month.period}
              cells={[fullMonth(month.period), formatMoney(month.collected, currency)]}
            />
          ))}
        </ChartTable>
      }
    >
      <ResponsiveContainer width="100%" height={224}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id="collectedFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--viz-series-1)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--viz-series-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--viz-grid)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="period" tickFormatter={shortMonth} {...AXIS} />
          <YAxis tickFormatter={compact} width={52} {...AXIS} />
          <Tooltip
            cursor={{ stroke: 'var(--viz-axis)', strokeWidth: 1 }}
            content={<ChartTooltip currency={currency} />}
          />
          <Area
            type="monotone"
            dataKey="collected"
            name="Collected"
            stroke="var(--viz-series-1)"
            strokeWidth={2}
            fill="url(#collectedFill)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

/** Two distinct series — legend required, and both are direct-labelled by it. */
export function ExpectedVsCollectedChart({
  months,
  currency,
  loading,
}: {
  months: DashboardCharts['months'];
  currency: string;
  loading?: boolean;
}) {
  const data = months.map((month) => ({
    period: month.period,
    expected: Number(month.expected),
    collected: Number(month.collected),
  }));
  const empty = data.every((point) => point.expected === 0 && point.collected === 0);

  return (
    <ChartShell
      title="Charged against collected"
      description="The gap between the two is what is still owed."
      loading={loading}
      empty={empty}
      emptyMessage="No charges in this window."
      table={
        <ChartTable head={['Month', 'Charged', 'Collected', 'Rate']}>
          {months.map((month) => (
            <ChartTableRow
              key={month.period}
              cells={[
                fullMonth(month.period),
                formatMoney(month.expected, currency),
                formatMoney(month.collected, currency),
                `${month.collectionRate}%`,
              ]}
            />
          ))}
        </ChartTable>
      }
    >
      <ResponsiveContainer width="100%" height={224}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barGap={2}>
          <CartesianGrid stroke="var(--viz-grid)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="period" tickFormatter={shortMonth} {...AXIS} />
          <YAxis tickFormatter={compact} width={52} {...AXIS} />
          <Tooltip
            cursor={{ fill: 'var(--viz-grid)', fillOpacity: 0.4 }}
            content={<ChartTooltip currency={currency} />}
          />
          <Legend wrapperStyle={legendStyle} iconType="square" iconSize={8} formatter={legendLabel} />
          {/* 4px rounded data-ends, anchored to the baseline. */}
          <Bar dataKey="expected" name="Charged" fill="var(--viz-series-2)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="collected" name="Collected" fill="var(--viz-series-1)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

/**
 * Above and below a baseline: a diverging bar.
 *
 * Two poles and a grey zero line, never a hue at the midpoint. A month that
 * lost money must look different from a month that made none.
 */
export function NetIncomeChart({
  months,
  currency,
  loading,
}: {
  months: DashboardCharts['months'];
  currency: string;
  loading?: boolean;
}) {
  const data = months.map((month) => ({
    period: month.period,
    netIncome: Number(month.netIncome),
  }));
  const empty = data.every((point) => point.netIncome === 0);

  return (
    <ChartShell
      title="Net income"
      description="Collected minus spent, on a cash basis."
      loading={loading}
      empty={empty}
      emptyMessage="Nothing collected or spent in this window."
      table={
        <ChartTable head={['Month', 'Collected', 'Expenses', 'Net']}>
          {months.map((month) => (
            <ChartTableRow
              key={month.period}
              cells={[
                fullMonth(month.period),
                formatMoney(month.collected, currency),
                formatMoney(month.expenses, currency),
                formatMoney(month.netIncome, currency),
              ]}
            />
          ))}
        </ChartTable>
      }
    >
      <ResponsiveContainer width="100%" height={224}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--viz-grid)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="period" tickFormatter={shortMonth} {...AXIS} />
          <YAxis tickFormatter={compact} width={52} {...AXIS} />
          <Tooltip
            cursor={{ fill: 'var(--viz-grid)', fillOpacity: 0.4 }}
            content={<ChartTooltip currency={currency} />}
          />
          <ReferenceLine y={0} stroke="var(--viz-axis)" strokeWidth={1} />
          <Bar dataKey="netIncome" name="Net income" radius={[4, 4, 0, 0]}>
            {data.map((point) => (
              <Cell
                key={point.period}
                fill={point.netIncome < 0 ? 'var(--viz-negative)' : 'var(--viz-positive)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

/** One series over time — no legend, and a percentage axis pinned to 0–100. */
export function OccupancyTrendChart({
  months,
  loading,
}: {
  months: DashboardCharts['months'];
  loading?: boolean;
}) {
  const data = months.map((month) => ({
    period: month.period,
    occupancyRate: month.occupancyRate,
  }));
  const empty = data.every((point) => point.occupancyRate === 0);

  return (
    <ChartShell
      title="Occupancy"
      description="Units under a live lease, as a share of the portfolio."
      loading={loading}
      empty={empty}
      emptyMessage="No leases in this window."
      table={
        <ChartTable head={['Month', 'Occupancy']}>
          {months.map((month) => (
            <ChartTableRow key={month.period} cells={[fullMonth(month.period), `${month.occupancyRate}%`]} />
          ))}
        </ChartTable>
      }
    >
      <ResponsiveContainer width="100%" height={224}>
        {/* No negative left margin here: a percentage tick is wider than a
            compact money tick, and -18 clipped "100%" down to "!0%". */}
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--viz-grid)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="period" tickFormatter={shortMonth} {...AXIS} />
          {/* Fixed to 0–100: an auto domain makes a wobble between 94% and 96%
              look like a collapse. */}
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(value: number) => `${value}%`}
            width={40}
            {...AXIS}
          />
          <Tooltip
            cursor={{ stroke: 'var(--viz-axis)', strokeWidth: 1 }}
            content={
              <ChartTooltip currency="" formatValue={(value) => `${value}%`} />
            }
          />
          <Line
            type="monotone"
            dataKey="occupancyRate"
            name="Occupancy"
            stroke="var(--viz-series-3)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

/**
 * Magnitude across many named categories.
 *
 * A horizontal bar in one hue rather than a donut in thirteen: there are
 * thirteen expense categories, and thirteen categorical hues is past the point
 * where anyone can tell them apart. Long names also read properly on this axis.
 */
export function ExpensesByCategoryChart({
  categories,
  currency,
  loading,
}: {
  categories: DashboardCharts['expensesByCategory'];
  currency: string;
  loading?: boolean;
}) {
  const data = categories.slice(0, 8).map((row) => ({
    category: EXPENSE_CATEGORY_LABELS[row.category as ExpenseCategory] ?? row.category,
    total: Number(row.total),
  }));

  return (
    <ChartShell
      title="Where the money went"
      description={
        categories.length > 8
          ? `The eight biggest of ${categories.length} categories.`
          : 'Spending by category.'
      }
      loading={loading}
      empty={categories.length === 0}
      emptyMessage="No expenses recorded in this window."
      table={
        <ChartTable head={['Category', 'Spent', 'Items']}>
          {categories.map((row) => (
            <ChartTableRow
              key={row.category}
              cells={[
                EXPENSE_CATEGORY_LABELS[row.category as ExpenseCategory] ?? row.category,
                formatMoney(row.total, currency),
                row.count,
              ]}
            />
          ))}
        </ChartTable>
      }
    >
      <ResponsiveContainer width="100%" height={224}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 12, bottom: 0, left: 8 }}
        >
          <CartesianGrid stroke="var(--viz-grid)" strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tickFormatter={compact} {...AXIS} />
          <YAxis type="category" dataKey="category" width={96} {...AXIS} />
          <Tooltip
            cursor={{ fill: 'var(--viz-grid)', fillOpacity: 0.4 }}
            content={<ChartTooltip currency={currency} labelFormatter={(label) => label} />}
          />
          <Bar dataKey="total" name="Spent" fill="var(--viz-series-2)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

/** Two series per property — the same two colours they carry everywhere else. */
export function PropertyPerformanceChart({
  properties,
  currency,
  loading,
}: {
  properties: DashboardCharts['propertyPerformance'];
  currency: string;
  loading?: boolean;
}) {
  const data = properties.slice(0, 8).map((row) => ({
    name: row.name,
    collected: Number(row.collected),
    expenses: Number(row.expenses),
  }));

  return (
    <ChartShell
      title="Property performance"
      description="Collected against what each one cost to run."
      loading={loading}
      empty={properties.length === 0}
      emptyMessage="No properties to compare yet."
      table={
        <ChartTable head={['Property', 'Collected', 'Expenses', 'Net']}>
          {properties.map((row) => (
            <ChartTableRow
              key={row.id}
              cells={[
                row.name,
                formatMoney(row.collected, currency),
                formatMoney(row.expenses, currency),
                formatMoney(row.netIncome, currency),
              ]}
            />
          ))}
        </ChartTable>
      }
    >
      <ResponsiveContainer width="100%" height={224}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 12, bottom: 0, left: 8 }}
          barGap={2}
        >
          <CartesianGrid stroke="var(--viz-grid)" strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tickFormatter={compact} {...AXIS} />
          <YAxis type="category" dataKey="name" width={110} {...AXIS} />
          <Tooltip
            cursor={{ fill: 'var(--viz-grid)', fillOpacity: 0.4 }}
            content={<ChartTooltip currency={currency} labelFormatter={(label) => label} />}
          />
          <Legend wrapperStyle={legendStyle} iconType="square" iconSize={8} formatter={legendLabel} />
          <Bar dataKey="collected" name="Collected" fill="var(--viz-series-1)" radius={[0, 4, 4, 0]} />
          <Bar dataKey="expenses" name="Expenses" fill="var(--viz-series-2)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

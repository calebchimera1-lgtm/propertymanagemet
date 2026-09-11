'use client';

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * A single headline number.
 *
 * A stat tile rather than a one-bar chart: a current value with a delta is not
 * a comparison, and drawing it as one wastes the space and buries the number.
 */
export function StatTile({
  label,
  value,
  hint,
  delta,
  /** Which direction is good. Rent up is good; expenses up is not. */
  deltaGoodWhen = 'up',
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  /** Percentage points, already signed. */
  delta?: number | null;
  deltaGoodWhen?: 'up' | 'down';
  tone?: 'default' | 'positive' | 'negative';
}) {
  const isFlat = delta === null || delta === undefined || Math.abs(delta) < 0.01;
  const isUp = (delta ?? 0) > 0;
  const isGood = isUp === (deltaGoodWhen === 'up');
  const DeltaIcon = isFlat ? Minus : isUp ? ArrowUpRight : ArrowDownRight;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={cn(
            'text-2xl tabular-nums',
            tone === 'positive' && 'text-success',
            tone === 'negative' && 'text-destructive',
          )}
        >
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
        {delta !== undefined ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 font-medium',
              // Never colour alone: the arrow carries the direction too.
              isFlat ? 'text-muted-foreground' : isGood ? 'text-success' : 'text-destructive',
            )}
          >
            <DeltaIcon className="h-3.5 w-3.5" aria-hidden />
            {isFlat ? 'No change' : `${Math.abs(delta ?? 0).toFixed(1)} pts`}
          </span>
        ) : null}
        {hint ? <span className="min-w-0 truncate">{hint}</span> : null}
      </CardContent>
    </Card>
  );
}

'use client';

import { Search, X } from 'lucide-react';
import type * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** A "no filter" value: Radix Select cannot hold an empty string. */
export const ALL_VALUE = '__all__';

export function DataTableToolbar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search',
  children,
  onClear,
  hasFilters,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  children?: React.ReactNode;
  onClear?: () => void;
  hasFilters?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="relative lg:max-w-xs lg:flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          className="pl-9"
          placeholder={searchPlaceholder}
          value={search}
          aria-label={searchPlaceholder}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {hasFilters && onClear ? (
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X className="h-4 w-4" aria-hidden />
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = 'All',
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: { value: string; label: string }[];
  allLabel?: string;
}) {
  return (
    <Select
      value={value ?? ALL_VALUE}
      onValueChange={(next) => onChange(next === ALL_VALUE ? undefined : next)}
    >
      <SelectTrigger className="h-10 w-[170px]" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

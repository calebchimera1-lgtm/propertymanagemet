'use client';

import { useCallback, useMemo, useState } from 'react';
import { useDebounced } from '@/hooks/use-debounced';

export interface TableParams {
  page: number;
  limit: number;
  search: string;
  sortBy?: string;
  sortOrder: 'asc' | 'desc';
}

/**
 * One place for list-screen state: search, sort, page.
 *
 * Anything that narrows the result set resets to page 1 — otherwise a user on
 * page 4 types a search term and lands on an empty page 4 of two results.
 */
export function useTableParams(initial: Partial<TableParams> = {}) {
  const [search, setSearch] = useState(initial.search ?? '');
  const [page, setPage] = useState(initial.page ?? 1);
  const [sortBy, setSortBy] = useState(initial.sortBy ?? 'createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(initial.sortOrder ?? 'desc');
  const [filters, setFilters] = useState<Record<string, string | undefined>>({});

  const debouncedSearch = useDebounced(search, 300);

  const toggleSort = useCallback((key: string) => {
    setSortBy((currentKey) => {
      setSortOrder((currentOrder) =>
        currentKey === key ? (currentOrder === 'asc' ? 'desc' : 'asc') : 'asc',
      );
      return key;
    });
    setPage(1);
  }, []);

  const setFilter = useCallback((key: string, value: string | undefined) => {
    setFilters((current) => ({ ...current, [key]: value || undefined }));
    setPage(1);
  }, []);

  const onSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const query = useMemo(
    () => ({
      page,
      limit: initial.limit ?? 20,
      search: debouncedSearch || undefined,
      sortBy,
      sortOrder,
      ...filters,
    }),
    [page, initial.limit, debouncedSearch, sortBy, sortOrder, filters],
  );

  return {
    query,
    search,
    onSearchChange,
    page,
    setPage,
    sortBy,
    sortOrder,
    toggleSort,
    filters,
    setFilter,
  };
}

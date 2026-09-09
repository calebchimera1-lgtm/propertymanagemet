import { z } from 'zod';

export const PAGINATION_DEFAULT_LIMIT = 20;
export const PAGINATION_MAX_LIMIT = 100;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  search: z.string().trim().max(200).optional(),
  sortBy: z.string().trim().max(50).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const cuidSchema = z.string().min(1).max(64);

export type PaginationInput = z.infer<typeof paginationSchema>;

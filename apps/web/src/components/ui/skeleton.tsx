import { cn } from '@/lib/utils';

/**
 * Loading placeholders mirror the shape of the content that replaces them, so
 * the page does not jump when data arrives.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

import type { IdType, LeaseStatus } from './types';

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'info' | 'outline';

export const LEASE_STATUS_LABELS: Record<LeaseStatus, string> = {
  ACTIVE: 'Active',
  EXPIRING_SOON: 'Expiring soon',
  EXPIRED: 'Expired',
  TERMINATED: 'Terminated',
};

/**
 * "Expired" is amber, not red: a tenant staying past the end date is normal and
 * needs attention, not alarm. "Terminated" is neutral — it is a closed record,
 * not a problem.
 */
export const LEASE_STATUS_VARIANTS: Record<LeaseStatus, BadgeVariant> = {
  ACTIVE: 'success',
  EXPIRING_SOON: 'info',
  EXPIRED: 'warning',
  TERMINATED: 'secondary',
};

export const ID_TYPE_LABELS: Record<IdType, string> = {
  NATIONAL_ID: 'National ID',
  PASSPORT: 'Passport',
  ALIEN_ID: 'Alien ID',
  MILITARY_ID: 'Military ID',
  OTHER: 'Other',
};

/** Human phrasing for the derived countdown the API returns. */
export function expiryLabel(daysUntilExpiry: number | null): string {
  if (daysUntilExpiry === null) return 'Open-ended';
  if (daysUntilExpiry < 0) {
    const days = Math.abs(daysUntilExpiry);
    return `Ended ${days} day${days === 1 ? '' : 's'} ago`;
  }
  if (daysUntilExpiry === 0) return 'Ends today';
  return `${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'} left`;
}

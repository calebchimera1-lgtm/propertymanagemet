import type {
  BuildingStatus,
  PropertyStatus,
  PropertyType,
  UnitStatus,
  UnitType,
} from './types';

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'info' | 'outline';

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  APARTMENT: 'Apartment',
  RESIDENTIAL: 'Residential',
  COMMERCIAL: 'Commercial',
  OFFICE: 'Office',
  SHOPS: 'Shops',
  WAREHOUSE: 'Warehouse',
  MIXED_USE: 'Mixed use',
  OTHER: 'Other',
};

export const PROPERTY_STATUS_LABELS: Record<PropertyStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  ARCHIVED: 'Archived',
};

export const BUILDING_STATUS_LABELS: Record<BuildingStatus, string> = PROPERTY_STATUS_LABELS;

export const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  BEDSITTER: 'Bedsitter',
  STUDIO: 'Studio',
  ONE_BEDROOM: '1 bedroom',
  TWO_BEDROOM: '2 bedroom',
  THREE_BEDROOM: '3 bedroom',
  FOUR_BEDROOM: '4 bedroom',
  SHOP: 'Shop',
  OFFICE: 'Office',
  WAREHOUSE: 'Warehouse',
  OTHER: 'Other',
};

export const UNIT_STATUS_LABELS: Record<UnitStatus, string> = {
  VACANT: 'Vacant',
  OCCUPIED: 'Occupied',
  RESERVED: 'Reserved',
  MAINTENANCE: 'Maintenance',
  UNAVAILABLE: 'Unavailable',
};

/**
 * Status colours are decided once, here.
 *
 * "Occupied" is the good outcome for a landlord, so it is green; "vacant" is
 * neutral rather than red, because an empty unit is normal, not an error.
 */
export const UNIT_STATUS_VARIANTS: Record<UnitStatus, BadgeVariant> = {
  VACANT: 'secondary',
  OCCUPIED: 'success',
  RESERVED: 'info',
  MAINTENANCE: 'warning',
  UNAVAILABLE: 'destructive',
};

export const PROPERTY_STATUS_VARIANTS: Record<PropertyStatus, BadgeVariant> = {
  ACTIVE: 'success',
  INACTIVE: 'secondary',
  ARCHIVED: 'outline',
};

export function selectOptions<T extends string>(labels: Record<T, string>) {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}

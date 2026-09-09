export type PropertyType =
  | 'APARTMENT'
  | 'RESIDENTIAL'
  | 'COMMERCIAL'
  | 'OFFICE'
  | 'SHOPS'
  | 'WAREHOUSE'
  | 'MIXED_USE'
  | 'OTHER';

export type PropertyStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type BuildingStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export type UnitType =
  | 'BEDSITTER'
  | 'STUDIO'
  | 'ONE_BEDROOM'
  | 'TWO_BEDROOM'
  | 'THREE_BEDROOM'
  | 'FOUR_BEDROOM'
  | 'SHOP'
  | 'OFFICE'
  | 'WAREHOUSE'
  | 'OTHER';

export type UnitStatus = 'VACANT' | 'OCCUPIED' | 'RESERVED' | 'MAINTENANCE' | 'UNAVAILABLE';

export interface Property {
  id: string;
  name: string;
  propertyType: PropertyType;
  description: string | null;
  addressLine: string | null;
  city: string | null;
  county: string | null;
  country: string;
  latitude: string | null;
  longitude: string | null;
  imageUrl: string | null;
  status: PropertyStatus;
  createdAt: string;
  updatedAt: string;
  buildingCount: number;
  unitCount: number;
}

export interface PropertySummary {
  property: Property;
  units: {
    total: number;
    vacant: number;
    occupied: number;
    reserved: number;
    maintenance: number;
    unavailable: number;
  };
  occupancyRate: number;
  /** Decimal as a string. Never parsed into a number for arithmetic. */
  potentialMonthlyRent: string;
}

export interface Building {
  id: string;
  propertyId: string;
  name: string;
  description: string | null;
  floors: number | null;
  status: BuildingStatus;
  createdAt: string;
  updatedAt: string;
  property: { id: string; name: string };
  unitCount: number;
}

export interface Unit {
  id: string;
  propertyId: string;
  buildingId: string | null;
  unitNumber: string;
  unitType: UnitType;
  floor: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  /** Decimal as a string, e.g. "32000.00". Formatted for display only. */
  monthlyRent: string;
  securityDeposit: string;
  status: UnitStatus;
  waterMeterNumber: string | null;
  electricityMeterNumber: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  property: { id: string; name: string };
  building: { id: string; name: string } | null;
}

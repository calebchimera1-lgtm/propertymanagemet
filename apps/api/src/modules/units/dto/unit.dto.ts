import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const UNIT_TYPES = [
  'BEDSITTER',
  'STUDIO',
  'ONE_BEDROOM',
  'TWO_BEDROOM',
  'THREE_BEDROOM',
  'FOUR_BEDROOM',
  'SHOP',
  'OFFICE',
  'WAREHOUSE',
  'OTHER',
] as const;

export const UNIT_STATUSES = [
  'VACANT',
  'OCCUPIED',
  'RESERVED',
  'MAINTENANCE',
  'UNAVAILABLE',
] as const;

/**
 * Statuses a person may set by hand.
 *
 * VACANT and OCCUPIED are excluded because from Phase 3 they are derived from
 * leases. Letting someone mark an occupied unit vacant would put the unit table
 * and the lease table into permanent disagreement.
 */
export const MANUAL_UNIT_STATUSES = ['RESERVED', 'MAINTENANCE', 'UNAVAILABLE', 'VACANT'] as const;

export const UNIT_SORT_FIELDS = ['unitNumber', 'monthlyRent', 'createdAt', 'updatedAt', 'floor'] as const;

/** Money arrives as a string and stays one: "30000.00", never 30000.00. */
const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

export class CreateUnitDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  propertyId!: string;

  @ApiPropertyOptional({ description: 'Omit for a unit that hangs directly off the property.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  buildingId?: string;

  @ApiProperty({ example: 'A12' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unitNumber!: string;

  @ApiProperty({ enum: UNIT_TYPES })
  @IsIn(UNIT_TYPES)
  unitType!: (typeof UNIT_TYPES)[number];

  @ApiProperty({
    example: '32000.00',
    description:
      'Decimal as a string. A JSON number cannot represent money exactly, so the API neither accepts nor returns one.',
  })
  @Transform(trim)
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'monthlyRent must be an amount such as "32000.00"' })
  monthlyRent!: string;

  @ApiPropertyOptional({ example: '32000.00', default: '0' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'securityDeposit must be an amount such as "32000.00"' })
  securityDeposit?: string;

  @ApiPropertyOptional({ minimum: -10, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-10)
  @Max(200)
  floor?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  bedrooms?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  bathrooms?: number;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  waterMeterNumber?: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  electricityMeterNumber?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;
}

/**
 * OmitType, not just a `declare propertyId?: never`.
 *
 * A type-level declaration removes the field from TypeScript but leaves its
 * class-validator metadata in place, so the property stays whitelisted and the
 * request is accepted at runtime. Omitting it means the global pipe rejects it.
 */
export class UpdateUnitDto extends PartialType(
  OmitType(CreateUnitDto, ['propertyId'] as const),
) {}

export class UpdateUnitStatusDto {
  @ApiProperty({
    enum: MANUAL_UNIT_STATUSES,
    description: 'OCCUPIED is not settable by hand: from Phase 3 it is derived from leases.',
  })
  @IsIn(MANUAL_UNIT_STATUSES)
  status!: (typeof MANUAL_UNIT_STATUSES)[number];

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ListUnitsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  propertyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  buildingId?: string;

  @ApiPropertyOptional({ enum: UNIT_STATUSES })
  @IsOptional()
  @IsIn(UNIT_STATUSES)
  status?: (typeof UNIT_STATUSES)[number];

  @ApiPropertyOptional({ enum: UNIT_TYPES })
  @IsOptional()
  @IsIn(UNIT_TYPES)
  unitType?: (typeof UNIT_TYPES)[number];

  @ApiPropertyOptional({ example: '10000' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'minRent must be an amount such as "10000"' })
  minRent?: string;

  @ApiPropertyOptional({ example: '80000' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'maxRent must be an amount such as "80000"' })
  maxRent?: string;

  @ApiPropertyOptional({ enum: UNIT_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(UNIT_SORT_FIELDS)
  declare sortBy?: (typeof UNIT_SORT_FIELDS)[number];
}

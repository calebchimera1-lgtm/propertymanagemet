import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
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

export const LEASE_STATUSES = ['ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'TERMINATED'] as const;
export const LEASE_SORT_FIELDS = ['startDate', 'endDate', 'createdAt', 'monthlyRent'] as const;

const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

export class CreateLeaseDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  tenantId!: string;

  @ApiProperty({ description: 'Must be vacant. Its property and building are taken from the unit.' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  unitId!: string;

  @ApiProperty({ example: '2026-01-01', description: 'ISO date. Time is ignored.' })
  @IsDateString({ strict: false }, { message: 'startDate must be a date such as 2026-01-01' })
  startDate!: string;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'Omit for an open-ended lease. Nothing expires without one.',
  })
  @IsOptional()
  @IsDateString({ strict: false }, { message: 'endDate must be a date such as 2026-12-31' })
  endDate?: string;

  @ApiPropertyOptional({
    example: '32000.00',
    description:
      'Defaults to the unit’s current rent. Copied onto the lease, so a later change to the unit does not rewrite what a sitting tenant agreed to pay.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'monthlyRent must be an amount such as "32000.00"' })
  monthlyRent?: string;

  @ApiPropertyOptional({ example: '32000.00', description: 'Defaults to the unit’s deposit.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'securityDeposit must be an amount such as "32000.00"' })
  securityDeposit?: string;

  @ApiPropertyOptional({ example: '32000.00', description: 'How much of the deposit was received.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'depositPaid must be an amount such as "32000.00"' })
  depositPaid?: string;

  @ApiProperty({ minimum: 1, maximum: 28, description: 'Day of month rent falls due.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(28)
  dueDay!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/**
 * What is NOT updatable, and why: tenantId, unitId, propertyId and startDate.
 *
 * Changing who or where a lease is for silently rewrites history — and from
 * Phase 4, rewrites what past rent records were billed against. Terminate the
 * lease and create a new one instead; that leaves an honest trail.
 */
export class UpdateLeaseDto {
  @ApiPropertyOptional({ example: '2027-12-31' })
  @IsOptional()
  @IsDateString({ strict: false })
  endDate?: string;

  @ApiPropertyOptional({ example: '35000.00' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'monthlyRent must be an amount such as "35000.00"' })
  monthlyRent?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'depositPaid must be an amount such as "32000.00"' })
  depositPaid?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 28 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(28)
  dueDay?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class RenewLeaseDto {
  @ApiProperty({ example: '2027-12-31', description: 'Must be later than the current end date.' })
  @IsDateString({ strict: false }, { message: 'endDate must be a date such as 2027-12-31' })
  endDate!: string;

  @ApiPropertyOptional({ example: '35000.00', description: 'A rent review, if the renewal has one.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'monthlyRent must be an amount such as "35000.00"' })
  monthlyRent?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class TerminateLeaseDto {
  @ApiPropertyOptional({ description: 'Recorded on the lease and in the audit trail.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({
    description:
      'Leave the unit out of service instead of vacant — for a move-out that needs repairs first.',
  })
  @IsOptional()
  @IsIn(['VACANT', 'MAINTENANCE'])
  unitStatus?: 'VACANT' | 'MAINTENANCE';
}

export class ListLeasesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: LEASE_STATUSES })
  @IsOptional()
  @IsIn(LEASE_STATUSES)
  status?: (typeof LEASE_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  propertyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tenantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  unitId?: string;

  @ApiPropertyOptional({ description: 'Only leases ending on or before this date.' })
  @IsOptional()
  @IsDateString({ strict: false })
  endingBefore?: string;

  @ApiPropertyOptional({ enum: LEASE_SORT_FIELDS, default: 'startDate' })
  @IsOptional()
  @IsIn(LEASE_SORT_FIELDS)
  declare sortBy?: (typeof LEASE_SORT_FIELDS)[number];
}

export class ExpiringLeasesQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 365, default: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

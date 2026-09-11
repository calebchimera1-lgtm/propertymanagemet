import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
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
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const REPORT_KEYS = [
  'rent-collection',
  'outstanding-rent',
  'tenants',
  'occupancy',
  'expenses',
  'income',
  'profit-loss',
  'maintenance',
  'lease-expiry',
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

export const EXPORT_FORMATS = ['csv', 'pdf'] as const;

/**
 * One filter DTO for every report.
 *
 * A shared shape rather than nine: the filters a report does not honour are
 * simply ignored by its strategy, and each strategy declares which ones it
 * uses so the UI can show only those. Nine near-identical DTOs would drift.
 */
export class ReportFiltersDto {
  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString({ strict: false }, { message: 'dateFrom must be a date such as 2026-01-01' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString({ strict: false }, { message: 'dateTo must be a date such as 2026-12-31' })
  dateTo?: string;

  @ApiPropertyOptional({ example: '2026-09', description: 'A single rental month.' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must look like 2026-09' })
  period?: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  unitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tenantId?: string;

  @ApiPropertyOptional({ description: 'Meaning depends on the report: rent, lease or job status.' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  @ApiPropertyOptional({ description: 'Expense category.' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  category?: string;

  @ApiPropertyOptional({ description: 'Payment method.' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  paymentMethod?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: 500 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class ExportReportQueryDto extends ReportFiltersDto {
  @ApiPropertyOptional({ enum: EXPORT_FORMATS, default: 'csv' })
  @IsOptional()
  @IsIn(EXPORT_FORMATS, { message: 'format must be csv or pdf' })
  format?: (typeof EXPORT_FORMATS)[number];
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';

export const RENT_STATUSES = ['PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'] as const;
export const RENT_SORT_FIELDS = ['dueDate', 'periodStart', 'balance', 'expectedAmount'] as const;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListRentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-09', description: 'Rental month.' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must look like 2026-09' })
  period?: string;

  @ApiPropertyOptional({ enum: RENT_STATUSES })
  @IsOptional()
  @IsIn(RENT_STATUSES)
  status?: (typeof RENT_STATUSES)[number];

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
  leaseId?: string;

  @ApiPropertyOptional({ description: 'Only records with money still owing.' })
  @IsOptional()
  @IsIn(['true', 'false'])
  unpaidOnly?: 'true' | 'false';

  @ApiPropertyOptional({ enum: RENT_SORT_FIELDS, default: 'dueDate' })
  @IsOptional()
  @IsIn(RENT_SORT_FIELDS)
  declare sortBy?: (typeof RENT_SORT_FIELDS)[number];
}

export class RentSummaryQueryDto {
  @ApiPropertyOptional({ example: '2026-09', description: 'Defaults to the current month.' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must look like 2026-09' })
  period?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  propertyId?: string;
}

export class GenerateRentDto {
  @ApiPropertyOptional({
    example: '2026-09',
    description: 'Rental month to generate. Defaults to the current one.',
  })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must look like 2026-09' })
  period?: string;
}

export class OutstandingRentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  propertyId?: string;

  @ApiPropertyOptional({ description: 'Only records overdue on or before this date.' })
  @IsOptional()
  @IsDateString({ strict: false })
  asOf?: string;
}

export class RentRecordIdParam {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  id!: string;
}

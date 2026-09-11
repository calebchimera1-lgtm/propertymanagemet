import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class DashboardSummaryQueryDto {
  @ApiPropertyOptional({ example: '2026-09', description: 'Rental month. Defaults to the current one.' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must look like 2026-09' })
  period?: string;

  @ApiPropertyOptional({ description: 'Narrow the whole dashboard to one property.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  propertyId?: string;
}

export class DashboardChartsQueryDto {
  @ApiPropertyOptional({ default: 12, minimum: 3, maximum: 24 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(3)
  @Max(24)
  months?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  propertyId?: string;
}

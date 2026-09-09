import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Note what this DTO does NOT accept: id, code, status or organizationId.
 * `forbidNonWhitelisted` rejects any request that tries to send them, so a
 * client cannot rename its own tenant boundary or move itself into another.
 */
export class UpdateOrganizationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^\+?[0-9\s-]{7,20}$/, { message: 'phone must be a valid phone number' })
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  addressLine?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  county?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  country?: string;
}

export class UpdateSettingsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 28, description: 'Rent due day for new leases' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  defaultDueDay?: number;

  @ApiPropertyOptional({ example: 'RCP' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Z]{2,6}$/, { message: 'receiptPrefix must be 2-6 uppercase letters' })
  receiptPrefix?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  leaseExpiryWarningDays?: number;
}

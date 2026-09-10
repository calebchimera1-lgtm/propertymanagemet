import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const ID_TYPES = ['NATIONAL_ID', 'PASSPORT', 'ALIEN_ID', 'MILITARY_ID', 'OTHER'] as const;
export const TENANT_SORT_FIELDS = ['fullName', 'createdAt', 'updatedAt'] as const;

const PHONE_PATTERN = /^\+?[0-9\s-]{7,20}$/;

export class CreateTenantDto {
  @ApiProperty({ example: 'Grace Wanjiku' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({ example: '+254711000001' })
  @Transform(trim)
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'phone must be a valid phone number' })
  phone!: string;

  @ApiPropertyOptional({ example: 'grace@example.com' })
  @IsOptional()
  @Transform(trimLower)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ enum: ID_TYPES })
  @IsOptional()
  @IsIn(ID_TYPES)
  idType?: (typeof ID_TYPES)[number];

  @ApiPropertyOptional({ description: 'National ID or passport number. Unique within your organization.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  nationalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  emergencyContactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'emergencyContactPhone must be a valid phone number' })
  emergencyContactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  occupation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateTenantDto extends PartialType(CreateTenantDto) {
  @ApiPropertyOptional({
    description:
      'Deactivating keeps the tenant and all their history but hides them from the default list.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListTenantsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only tenants with an active lease.' })
  @IsOptional()
  @IsIn(['true', 'false'])
  hasActiveLease?: 'true' | 'false';

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: 'true' | 'false';

  @ApiPropertyOptional({ description: 'Restrict to tenants leasing in this property.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  propertyId?: string;

  @ApiPropertyOptional({ enum: TENANT_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(TENANT_SORT_FIELDS)
  declare sortBy?: (typeof TENANT_SORT_FIELDS)[number];
}

import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const PROPERTY_TYPES = [
  'APARTMENT',
  'RESIDENTIAL',
  'COMMERCIAL',
  'OFFICE',
  'SHOPS',
  'WAREHOUSE',
  'MIXED_USE',
  'OTHER',
] as const;

export const PROPERTY_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;

export const PROPERTY_SORT_FIELDS = ['name', 'createdAt', 'updatedAt', 'city', 'propertyType'] as const;

/**
 * No organizationId field exists here, deliberately. With `whitelist` and
 * `forbidNonWhitelisted` on the global pipe, a client that sends one has its
 * request rejected outright rather than silently ignored.
 */
export class CreatePropertyDto {
  @ApiProperty({ example: 'Sunrise Estate', minLength: 2, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: PROPERTY_TYPES })
  @IsEnum(Object.fromEntries(PROPERTY_TYPES.map((type) => [type, type])))
  propertyType!: (typeof PROPERTY_TYPES)[number];

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  addressLine?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  county?: string;

  @ApiPropertyOptional({ maxLength: 100, default: 'Kenya' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({ example: -1.2921 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 36.8219 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsLongitude()
  longitude?: number;
}

export class UpdatePropertyDto extends PartialType(CreatePropertyDto) {
  @ApiPropertyOptional({ enum: PROPERTY_STATUSES })
  @IsOptional()
  @IsIn(PROPERTY_STATUSES)
  status?: (typeof PROPERTY_STATUSES)[number];
}

export class ListPropertiesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PROPERTY_TYPES })
  @IsOptional()
  @IsIn(PROPERTY_TYPES)
  propertyType?: (typeof PROPERTY_TYPES)[number];

  @ApiPropertyOptional({ enum: PROPERTY_STATUSES })
  @IsOptional()
  @IsIn(PROPERTY_STATUSES)
  status?: (typeof PROPERTY_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ enum: PROPERTY_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(PROPERTY_SORT_FIELDS)
  declare sortBy?: (typeof PROPERTY_SORT_FIELDS)[number];
}

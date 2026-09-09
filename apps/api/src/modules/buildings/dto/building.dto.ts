import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const BUILDING_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
export const BUILDING_SORT_FIELDS = ['name', 'createdAt', 'updatedAt', 'floors'] as const;

export class CreateBuildingDto {
  @ApiProperty({ description: 'Must be a property in your own organization.' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  propertyId!: string;

  @ApiProperty({ example: 'Block A', minLength: 1, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  floors?: number;
}

/**
 * propertyId is omitted from updates on purpose: moving a building between
 * properties would silently relocate every unit under it and orphan any lease
 * history from Phase 3 onward. Delete and recreate, or ask for a dedicated
 * "move" operation with its own rules.
 */
export class UpdateBuildingDto extends PartialType(
  OmitType(CreateBuildingDto, ['propertyId'] as const),
) {
  @ApiPropertyOptional({ enum: BUILDING_STATUSES })
  @IsOptional()
  @IsIn(BUILDING_STATUSES)
  status?: (typeof BUILDING_STATUSES)[number];
}

export class ListBuildingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  propertyId?: string;

  @ApiPropertyOptional({ enum: BUILDING_STATUSES })
  @IsOptional()
  @IsIn(BUILDING_STATUSES)
  status?: (typeof BUILDING_STATUSES)[number];

  @ApiPropertyOptional({ enum: BUILDING_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(BUILDING_SORT_FIELDS)
  declare sortBy?: (typeof BUILDING_SORT_FIELDS)[number];
}

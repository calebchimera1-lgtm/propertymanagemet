import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * SUPER_ADMIN is absent on purpose.
 *
 * It is a platform role, not an organization one. Letting an owner grant it
 * through the staff form would be a privilege-escalation path in the shape of a
 * dropdown, so it is not in the list the API will accept.
 */
export const ASSIGNABLE_ROLES = [
  'PROPERTY_OWNER',
  'PROPERTY_MANAGER',
  'ACCOUNTANT',
  'CARETAKER',
] as const;

export const STAFF_STATUSES = ['ACTIVE', 'INACTIVE', 'INVITED', 'SUSPENDED'] as const;
export const STAFF_SORT_FIELDS = ['fullName', 'email', 'createdAt', 'lastLoginAt'] as const;

export class CreateStaffDto {
  @ApiProperty({ example: 'caretaker@example.com' })
  @Transform(lower)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Peter Kamau' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'fullName must be at least 2 characters' })
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({ enum: ASSIGNABLE_ROLES })
  @IsIn(ASSIGNABLE_ROLES, { message: 'role must be one of the assignable staff roles' })
  role!: (typeof ASSIGNABLE_ROLES)[number];

  @ApiPropertyOptional({ example: '+254711000123' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({
    description:
      'Properties this person may see. Only meaningful for property-scoped roles; an empty array means they see nothing until assigned.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  propertyIds?: string[];
}

export class UpdateStaffDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({
    enum: ASSIGNABLE_ROLES,
    description: 'Changing a role takes effect on the person’s next request.',
  })
  @IsOptional()
  @IsIn(ASSIGNABLE_ROLES)
  role?: (typeof ASSIGNABLE_ROLES)[number];
}

export class AssignPropertiesDto {
  @ApiProperty({
    type: [String],
    description:
      'Replaces the whole set. An empty array means this person sees no properties at all.',
  })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  propertyIds!: string[];
}

export class ListStaffQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ASSIGNABLE_ROLES })
  @IsOptional()
  @IsIn(ASSIGNABLE_ROLES)
  role?: (typeof ASSIGNABLE_ROLES)[number];

  @ApiPropertyOptional({ enum: STAFF_STATUSES })
  @IsOptional()
  @IsIn(STAFF_STATUSES)
  status?: (typeof STAFF_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Only staff assigned to this property.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  propertyId?: string;

  @ApiPropertyOptional({ enum: STAFF_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(STAFF_SORT_FIELDS)
  declare sortBy?: (typeof STAFF_SORT_FIELDS)[number];
}

import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { MONEY_PATTERN } from '@/common/money/money';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const MAINTENANCE_STATUSES = [
  'PENDING',
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;

export const MAINTENANCE_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export const MAINTENANCE_SORT_FIELDS = ['createdAt', 'priority', 'status', 'updatedAt'] as const;

export class CreateMaintenanceDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  propertyId!: string;

  @ApiPropertyOptional({ description: 'Narrow the job to one block.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  buildingId?: string;

  @ApiPropertyOptional({ description: 'Narrow the job to one unit.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  unitId?: string;

  @ApiPropertyOptional({ description: 'The tenant who reported it, when there is one.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tenantId?: string;

  @ApiProperty({ example: 'Kitchen tap will not close' })
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'title must say what the job is' })
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: 'Dripping constantly since Tuesday; washer looks worn.' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  description!: string;

  @ApiPropertyOptional({ enum: MAINTENANCE_PRIORITIES, default: 'MEDIUM' })
  @IsOptional()
  @IsIn(MAINTENANCE_PRIORITIES)
  priority?: (typeof MAINTENANCE_PRIORITIES)[number];

  @ApiPropertyOptional({ example: '4500.00', description: 'What it is expected to cost.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'estimatedCost must be an amount such as "4500.00"' })
  estimatedCost?: string;

  @ApiPropertyOptional({ description: 'Assign it to a staff member straight away.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignedToId?: string;
}

/**
 * Property, building, unit and tenant are fixed once a request exists.
 *
 * Moving a job between properties would rewrite where the work happened and
 * what its scope check was decided against. Cancel it and raise a new one.
 */
export class UpdateMaintenanceDto extends PartialType(
  OmitType(CreateMaintenanceDto, ['propertyId', 'buildingId', 'unitId', 'tenantId', 'assignedToId'] as const),
) {
  @ApiPropertyOptional({ example: '5200.00', description: 'What it actually cost.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'actualCost must be an amount such as "5200.00"' })
  actualCost?: string;
}

export class AssignMaintenanceDto {
  @ApiProperty({
    description:
      'A staff member in this organization who can see the property. Send null to unassign.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignedToId?: string | null;

  @ApiPropertyOptional({ description: 'Added to the timeline alongside the assignment.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class ChangeMaintenanceStatusDto {
  @ApiProperty({ enum: MAINTENANCE_STATUSES })
  @IsIn(MAINTENANCE_STATUSES)
  status!: (typeof MAINTENANCE_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Why. Recorded on the timeline.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({
    example: '5200.00',
    description: 'Recorded when completing the job. Does not create an expense — see the docs.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'actualCost must be an amount such as "5200.00"' })
  actualCost?: string;
}

export class AddMaintenanceUpdateDto {
  @ApiProperty({ example: 'Plumber booked for Thursday morning.' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'note must say something' })
  @MaxLength(2000)
  note!: string;
}

export class ListMaintenanceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MAINTENANCE_STATUSES })
  @IsOptional()
  @IsIn(MAINTENANCE_STATUSES)
  status?: (typeof MAINTENANCE_STATUSES)[number];

  @ApiPropertyOptional({ enum: MAINTENANCE_PRIORITIES })
  @IsOptional()
  @IsIn(MAINTENANCE_PRIORITIES)
  priority?: (typeof MAINTENANCE_PRIORITIES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  propertyId?: string;

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

  @ApiPropertyOptional({ description: 'A staff member id, or "me" for your own queue.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignedToId?: string;

  @ApiPropertyOptional({ description: 'Only requests that are not finished or cancelled.' })
  @IsOptional()
  @IsIn(['true', 'false'])
  openOnly?: 'true' | 'false';

  @ApiPropertyOptional({ enum: MAINTENANCE_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(MAINTENANCE_SORT_FIELDS)
  declare sortBy?: (typeof MAINTENANCE_SORT_FIELDS)[number];
}

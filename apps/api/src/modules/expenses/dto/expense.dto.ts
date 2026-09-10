import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { POSITIVE_MONEY_PATTERN } from '@/common/money/money';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const EXPENSE_CATEGORIES = [
  'MAINTENANCE',
  'REPAIRS',
  'SECURITY',
  'CLEANING',
  'WATER',
  'ELECTRICITY',
  'GARBAGE',
  'SALARIES',
  'INSURANCE',
  'TAXES',
  'MANAGEMENT',
  'CONSTRUCTION',
  'OTHER',
] as const;

export const EXPENSE_PAYMENT_METHODS = ['MPESA', 'BANK', 'CASH', 'CHEQUE', 'OTHER'] as const;
export const EXPENSE_SORT_FIELDS = ['expenseDate', 'amount', 'createdAt', 'category'] as const;

export class CreateExpenseDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  propertyId!: string;

  @ApiPropertyOptional({ description: 'Narrow the expense to one block.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  buildingId?: string;

  @ApiPropertyOptional({ description: 'Narrow the expense to one unit.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  unitId?: string;

  @ApiProperty({ enum: EXPENSE_CATEGORIES })
  @IsIn(EXPENSE_CATEGORIES)
  category!: (typeof EXPENSE_CATEGORIES)[number];

  @ApiProperty({ example: 'Replaced the water pump' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  description!: string;

  @ApiProperty({ example: '12500.00', description: 'Decimal as a string. Must be above zero.' })
  @Transform(trim)
  @IsString()
  @Matches(POSITIVE_MONEY_PATTERN, {
    message: 'amount must be an amount above zero, such as "12500.00"',
  })
  amount!: string;

  @ApiProperty({ example: '2026-09-05' })
  @IsDateString({ strict: false }, { message: 'expenseDate must be a date such as 2026-09-05' })
  expenseDate!: string;

  @ApiPropertyOptional({ enum: EXPENSE_PAYMENT_METHODS })
  @IsOptional()
  @IsIn(EXPENSE_PAYMENT_METHODS)
  paymentMethod?: (typeof EXPENSE_PAYMENT_METHODS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  vendor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  reference?: string;
}

/**
 * The property is fixed for the life of an expense: moving it would silently
 * rewrite two properties' profit and loss at once.
 */
export class UpdateExpenseDto extends PartialType(
  OmitType(CreateExpenseDto, ['propertyId'] as const),
) {}

export class ListExpensesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: EXPENSE_CATEGORIES })
  @IsOptional()
  @IsIn(EXPENSE_CATEGORIES)
  category?: (typeof EXPENSE_CATEGORIES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  propertyId?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString({ strict: false })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString({ strict: false })
  dateTo?: string;

  @ApiPropertyOptional({ enum: EXPENSE_SORT_FIELDS, default: 'expenseDate' })
  @IsOptional()
  @IsIn(EXPENSE_SORT_FIELDS)
  declare sortBy?: (typeof EXPENSE_SORT_FIELDS)[number];
}

export class ExpenseSummaryQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  propertyId?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString({ strict: false })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString({ strict: false })
  dateTo?: string;
}

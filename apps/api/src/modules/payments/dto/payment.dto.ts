import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export const PAYMENT_METHODS = ['MPESA', 'BANK', 'CASH', 'CHEQUE', 'OTHER'] as const;
export const PAYMENT_STATUSES = ['COMPLETED', 'VOIDED'] as const;
export const PAYMENT_SORT_FIELDS = ['paymentDate', 'amount', 'createdAt'] as const;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreatePaymentDto {
  @ApiProperty({
    description:
      'The month being paid for. Required: every payment is against a specific charge, which is what makes the totals reconcilable.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  rentRecordId!: string;

  @ApiProperty({
    example: '20000.00',
    description: 'Decimal as a string. Must not exceed what is still owing on the charge.',
  })
  @Transform(trim)
  @IsString()
  @Matches(POSITIVE_MONEY_PATTERN, {
    message: 'amount must be an amount above zero, such as "20000.00"',
  })
  amount!: string;

  @ApiProperty({ example: '2026-09-05' })
  @IsDateString({ strict: false }, { message: 'paymentDate must be a date such as 2026-09-05' })
  paymentDate!: string;

  @ApiProperty({
    enum: PAYMENT_METHODS,
    description:
      'M-Pesa is a manually entered reference in Version 1 — there is no gateway integration.',
  })
  @IsIn(PAYMENT_METHODS)
  paymentMethod!: (typeof PAYMENT_METHODS)[number];

  @ApiPropertyOptional({
    example: 'SJK4H7X9QP',
    description: 'Transaction code or slip number. Unique per organization and method.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class VoidPaymentDto {
  @ApiProperty({ description: 'Recorded on the payment and in the audit trail.' })
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'A reason is required when voiding a payment' })
  @MaxLength(500)
  reason!: string;
}

export class ListPaymentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PAYMENT_METHODS })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: (typeof PAYMENT_METHODS)[number];

  @ApiPropertyOptional({ enum: PAYMENT_STATUSES })
  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  status?: (typeof PAYMENT_STATUSES)[number];

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
  rentRecordId?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString({ strict: false })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString({ strict: false })
  dateTo?: string;

  @ApiPropertyOptional({ enum: PAYMENT_SORT_FIELDS, default: 'paymentDate' })
  @IsOptional()
  @IsIn(PAYMENT_SORT_FIELDS)
  declare sortBy?: (typeof PAYMENT_SORT_FIELDS)[number];
}

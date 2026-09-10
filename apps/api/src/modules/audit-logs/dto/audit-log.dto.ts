import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';

export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Who did it.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @ApiPropertyOptional({ example: 'PAYMENT_VOIDED' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;

  @ApiPropertyOptional({ example: 'Payment' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityId?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString({ strict: false })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString({ strict: false })
  dateTo?: string;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';

export const NOTIFICATION_TYPES = [
  'RENT_OVERDUE',
  'PAYMENT_RECORDED',
  'LEASE_EXPIRING',
  'MAINTENANCE_UPDATED',
  'SYSTEM',
] as const;

export class ListNotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only what has not been read.' })
  @IsOptional()
  @IsIn(['true', 'false'])
  unreadOnly?: 'true' | 'false';

  @ApiPropertyOptional({ enum: NOTIFICATION_TYPES })
  @IsOptional()
  @IsIn(NOTIFICATION_TYPES)
  type?: (typeof NOTIFICATION_TYPES)[number];
}

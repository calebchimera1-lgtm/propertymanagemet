import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'INVITED', 'SUSPENDED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'INVITED', 'SUSPENDED'])
  status?: 'ACTIVE' | 'INACTIVE' | 'INVITED' | 'SUSPENDED';
}

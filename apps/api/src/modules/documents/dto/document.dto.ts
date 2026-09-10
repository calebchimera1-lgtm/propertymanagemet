import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const DOCUMENT_ENTITY_TYPES = [
  'PROPERTY',
  'BUILDING',
  'UNIT',
  'TENANT',
  'LEASE',
  'EXPENSE',
  'MAINTENANCE',
  'ORGANIZATION',
] as const;

export const DOCUMENT_SORT_FIELDS = ['createdAt', 'name', 'sizeBytes'] as const;

/**
 * The metadata half of a multipart upload. The file itself arrives as the
 * `file` part and is validated separately — nothing in this class is trusted to
 * describe the bytes.
 */
export class UploadDocumentDto {
  @ApiProperty({ enum: DOCUMENT_ENTITY_TYPES, description: 'What this document belongs to.' })
  @IsIn(DOCUMENT_ENTITY_TYPES, { message: 'entityType must be a record type documents can attach to' })
  entityType!: (typeof DOCUMENT_ENTITY_TYPES)[number];

  @ApiPropertyOptional({
    description: 'The record it belongs to. Required for everything except ORGANIZATION.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityId?: string;

  @ApiPropertyOptional({
    description: 'A display name. Defaults to the uploaded filename, sanitised.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;
}

export class ListDocumentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DOCUMENT_ENTITY_TYPES })
  @IsOptional()
  @IsIn(DOCUMENT_ENTITY_TYPES)
  entityType?: (typeof DOCUMENT_ENTITY_TYPES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityId?: string;

  @ApiPropertyOptional({ enum: DOCUMENT_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(DOCUMENT_SORT_FIELDS)
  declare sortBy?: (typeof DOCUMENT_SORT_FIELDS)[number];
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermissions } from '@/common/decorators';
import type { UploadCandidate } from '@/providers/storage/file-validation';
import { DocumentsService } from './documents.service';
import { ListDocumentsQueryDto, UploadDocumentDto } from './dto/document.dto';

/**
 * Documents are streamed through this controller and nowhere else.
 *
 * The storage directory is not served statically and no endpoint returns a
 * storage key or a URL, so there is no path to a byte that skips the session,
 * permission, organization and property-scope checks below.
 */
@ApiTags('Documents')
@ApiCookieAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @RequirePermissions('documents.view')
  @ApiOperation({ summary: 'List documents' })
  @ApiOkResponse({ description: 'Paginated document metadata. Never a storage key or a URL.' })
  list(@Query() query: ListDocumentsQueryDto) {
    return this.documents.list(query);
  }

  @Get(':id')
  @RequirePermissions('documents.view')
  @ApiOperation({ summary: 'One document’s metadata' })
  @ApiNotFoundResponse({ description: 'No such document, or outside your scope.' })
  findOne(@Param('id') id: string) {
    return this.documents.findOne(id);
  }

  @Get(':id/download')
  @RequirePermissions('documents.view')
  @ApiOperation({
    summary: 'Download the file',
    description:
      'Always an attachment, never inline, and always with X-Content-Type-Options: nosniff — so a stored file can never execute in the app origin.',
  })
  @ApiNotFoundResponse({ description: 'No such document, or outside your scope.' })
  async download(@Param('id') id: string, @Res({ passthrough: false }) response: Response) {
    const { document, stream } = await this.documents.openForDownload(id);

    /*
     * These three headers are the reason an uploaded file cannot become an XSS.
     *
     * `attachment` stops the browser rendering it in this origin, `nosniff`
     * stops it second-guessing the declared type, and the CSP sandbox neuters
     * anything that still manages to be interpreted as a document.
     */
    response.setHeader('Content-Type', document.mimeType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.setHeader('Content-Length', String(document.sizeBytes));
    // The filename was sanitised on the way in; encodeURIComponent covers the
    // non-ASCII case so the header stays well-formed either way.
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${document.originalFilename}"; filename*=UTF-8''${encodeURIComponent(document.originalFilename)}`,
    );

    stream.pipe(response);
  }

  @Post()
  @RequirePermissions('documents.upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'entityType'],
      properties: {
        file: { type: 'string', format: 'binary' },
        entityType: { type: 'string' },
        entityId: { type: 'string' },
        name: { type: 'string' },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload a document',
    description:
      'Validated by size, extension, declared type and the real first bytes. The stored path is generated server-side; the uploaded filename is display metadata only.',
  })
  @ApiCreatedResponse({ description: 'The stored document’s metadata.' })
  @ApiUnprocessableEntityResponse({ description: 'The file failed the validation chain.' })
  /**
   * Typed as UploadCandidate rather than Express.Multer.File: the handler needs
   * exactly four fields, and the narrower type keeps the guarantee that nothing
   * downstream reads anything else off a multipart part.
   */
  upload(@Body() dto: UploadDocumentDto, @UploadedFile() file?: UploadCandidate) {
    return this.documents.upload(dto, file);
  }

  @Delete(':id')
  @RequirePermissions('documents.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a document and its stored file' })
  @ApiNoContentResponse({ description: 'Deleted.' })
  remove(@Param('id') id: string) {
    return this.documents.remove(id);
  }
}

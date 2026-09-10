import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators';
import { ListReceiptsQueryDto } from './dto/receipt.dto';
import { ReceiptsService } from './receipts.service';

@ApiTags('Receipts')
@ApiCookieAuth()
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get()
  @RequirePermissions('receipts.view')
  @ApiOperation({
    summary: 'The receipt register',
    description: 'Numbers are gapless per organization and per year. Voided receipts keep theirs.',
  })
  @ApiOkResponse({ description: 'Paginated receipts.' })
  list(@Query() query: ListReceiptsQueryDto) {
    return this.receipts.list(query);
  }

  @Get(':id')
  @RequirePermissions('receipts.view')
  @ApiOperation({
    summary: 'One receipt, with everything a printed copy needs',
    description: 'Includes the issuing organization’s details for the letterhead.',
  })
  @ApiNotFoundResponse({ description: 'No such receipt, or outside your scope.' })
  findOne(@Param('id') id: string) {
    return this.receipts.findOne(id);
  }
}

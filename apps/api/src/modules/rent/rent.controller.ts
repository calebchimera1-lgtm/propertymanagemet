import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators';
import {
  GenerateRentDto,
  ListRentQueryDto,
  OutstandingRentQueryDto,
  RentSummaryQueryDto,
} from './dto/rent.dto';
import { RentService } from './rent.service';

@ApiTags('Rent')
@ApiCookieAuth()
@Controller('rent')
export class RentController {
  constructor(private readonly rent: RentService) {}

  @Get()
  @RequirePermissions('rent.view')
  @ApiOperation({
    summary: 'The rent roll',
    description:
      'Monthly charges with expected, paid and outstanding amounts. All money is returned as fixed-scale strings.',
  })
  @ApiOkResponse({ description: 'Paginated rent records.' })
  list(@Query() query: ListRentQueryDto) {
    return this.rent.list(query);
  }

  @Get('outstanding')
  @RequirePermissions('rent.view')
  @ApiOperation({
    summary: 'The collections worklist',
    description: 'Everything still owing as of a date, oldest first, with the total outstanding.',
  })
  outstanding(@Query() query: OutstandingRentQueryDto) {
    return this.rent.outstanding(query);
  }

  @Get('summary')
  @RequirePermissions('rent.view')
  @ApiOperation({
    summary: 'Expected, collected, outstanding and overdue for a period',
    description:
      'Collected is summed from completed payments, not from stored balances, so the two are checked against each other rather than trusted.',
  })
  summary(@Query() query: RentSummaryQueryDto) {
    return this.rent.summary(query);
  }

  @Post('generate')
  @RequirePermissions('rent.generate')
  @ApiOperation({
    summary: 'Generate the charges for a period',
    description:
      'Idempotent: a second run creates nothing and reports how many were skipped. Expired leases are not billed — that is a decision for a person, and the count is reported back.',
  })
  generate(@Body() dto: GenerateRentDto) {
    return this.rent.generate(dto);
  }

  @Get(':id')
  @RequirePermissions('rent.view')
  @ApiOperation({ summary: 'One rent record with the payments applied to it' })
  @ApiNotFoundResponse({ description: 'No such record, or outside your scope.' })
  findOne(@Param('id') id: string) {
    return this.rent.findOne(id);
  }
}

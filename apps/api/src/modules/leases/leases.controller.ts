import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators';
import {
  CreateLeaseDto,
  ExpiringLeasesQueryDto,
  ListLeasesQueryDto,
  RenewLeaseDto,
  TerminateLeaseDto,
  UpdateLeaseDto,
} from './dto/lease.dto';
import { LeasesService } from './leases.service';

@ApiTags('Leases')
@ApiCookieAuth()
@Controller('leases')
export class LeasesController {
  constructor(private readonly leases: LeasesService) {}

  @Get()
  @RequirePermissions('leases.view')
  @ApiOperation({
    summary: 'List leases',
    description:
      'Each row carries daysUntilExpiry, derived on read rather than stored, so it is never stale.',
  })
  @ApiOkResponse({ description: 'Paginated leases.' })
  list(@Query() query: ListLeasesQueryDto) {
    return this.leases.list(query);
  }

  @Get('expiring')
  @RequirePermissions('leases.view')
  @ApiOperation({
    summary: 'Leases ending soon',
    description: 'The renewals worklist: live leases ending within the given number of days.',
  })
  expiring(@Query() query: ExpiringLeasesQueryDto) {
    return this.leases.expiring(query);
  }

  @Get(':id')
  @RequirePermissions('leases.view')
  @ApiOperation({ summary: 'One lease' })
  @ApiNotFoundResponse({ description: 'No such lease, or outside your scope.' })
  findOne(@Param('id') id: string) {
    return this.leases.findOne(id);
  }

  @Post()
  @RequirePermissions('leases.create')
  @ApiOperation({
    summary: 'Create a lease and occupy the unit',
    description:
      'One transaction: the lease is created and the unit becomes OCCUPIED together. Rent and deposit are copied from the unit unless overridden, so a later change to the unit does not rewrite a sitting tenant’s terms.',
  })
  @ApiCreatedResponse({ description: 'The created lease.' })
  @ApiConflictResponse({ description: 'The unit is not available.' })
  @ApiUnprocessableEntityResponse({ description: 'Incoherent dates or deposit.' })
  create(@Body() dto: CreateLeaseDto) {
    return this.leases.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('leases.update')
  @ApiOperation({
    summary: 'Update lease terms',
    description:
      'Terms only. The tenant, unit and start date are fixed for the life of the lease — changing them would rewrite history. Terminate and create a new lease instead.',
  })
  update(@Param('id') id: string, @Body() dto: UpdateLeaseDto) {
    return this.leases.update(id, dto);
  }

  @Post(':id/renew')
  @RequirePermissions('leases.update')
  @ApiOperation({
    summary: 'Extend a lease, optionally with a rent review',
    description: 'An expired lease can be renewed — that is the usual case when a tenant stays on.',
  })
  renew(@Param('id') id: string, @Body() dto: RenewLeaseDto) {
    return this.leases.renew(id, dto);
  }

  @Post(':id/terminate')
  @RequirePermissions('leases.terminate')
  @ApiOperation({
    summary: 'End a lease and free the unit',
    description:
      'One transaction. The lease is kept as the record of who lived there and on what terms; it is never deleted.',
  })
  @ApiConflictResponse({ description: 'The lease is already terminated.' })
  terminate(@Param('id') id: string, @Body() dto: TerminateLeaseDto) {
    return this.leases.terminate(id, dto);
  }
}

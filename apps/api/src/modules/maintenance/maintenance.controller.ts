import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators';
import {
  AddMaintenanceUpdateDto,
  AssignMaintenanceDto,
  ChangeMaintenanceStatusDto,
  CreateMaintenanceDto,
  ListMaintenanceQueryDto,
  UpdateMaintenanceDto,
} from './dto/maintenance.dto';
import { MaintenanceService } from './maintenance.service';

@ApiTags('Maintenance')
@ApiCookieAuth()
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  @RequirePermissions('maintenance.view')
  @ApiOperation({
    summary: 'List maintenance requests',
    description: 'Pass assignedToId=me for your own queue. Property-scoped like every list.',
  })
  @ApiOkResponse({ description: 'Paginated requests plus the count still open.' })
  list(@Query() query: ListMaintenanceQueryDto) {
    return this.maintenance.list(query);
  }

  @Get('summary')
  @RequirePermissions('maintenance.view')
  @ApiOperation({ summary: 'Counts by status, for the board columns' })
  summary() {
    return this.maintenance.summary();
  }

  @Get(':id')
  @RequirePermissions('maintenance.view')
  @ApiOperation({ summary: 'One request with its full timeline' })
  @ApiNotFoundResponse({ description: 'No such request, or outside your scope.' })
  findOne(@Param('id') id: string) {
    return this.maintenance.findOne(id);
  }

  @Get(':id/updates')
  @RequirePermissions('maintenance.view')
  @ApiOperation({ summary: 'The timeline on its own' })
  listUpdates(@Param('id') id: string) {
    return this.maintenance.listUpdates(id);
  }

  @Post()
  @RequirePermissions('maintenance.create')
  @ApiOperation({ summary: 'Raise a request' })
  @ApiCreatedResponse({ description: 'The request, with its first timeline entry.' })
  create(@Body() dto: CreateMaintenanceDto) {
    return this.maintenance.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('maintenance.update')
  @ApiOperation({
    summary: 'Edit a request',
    description: 'Property, building, unit and tenant are fixed once the request exists.',
  })
  @ApiConflictResponse({ description: 'A completed or cancelled request cannot be edited.' })
  update(@Param('id') id: string, @Body() dto: UpdateMaintenanceDto) {
    return this.maintenance.update(id, dto);
  }

  @Post(':id/assign')
  @RequirePermissions('maintenance.update')
  @ApiOperation({
    summary: 'Assign or unassign',
    description: 'Assigning a pending request moves it to ASSIGNED; clearing it moves it back.',
  })
  assign(@Param('id') id: string, @Body() dto: AssignMaintenanceDto) {
    return this.maintenance.assign(id, dto);
  }

  @Post(':id/status')
  @RequirePermissions('maintenance.update')
  @ApiOperation({
    summary: 'Move a request through the workflow',
    description:
      'Validated against the transition table: no jumping straight to completed, and no reopening a closed job.',
  })
  @ApiConflictResponse({ description: 'That transition is not allowed from the current status.' })
  changeStatus(@Param('id') id: string, @Body() dto: ChangeMaintenanceStatusDto) {
    return this.maintenance.changeStatus(id, dto);
  }

  @Post(':id/updates')
  @RequirePermissions('maintenance.update')
  @ApiOperation({ summary: 'Add a note to the timeline' })
  addUpdate(@Param('id') id: string, @Body() dto: AddMaintenanceUpdateDto) {
    return this.maintenance.addUpdate(id, dto);
  }
}

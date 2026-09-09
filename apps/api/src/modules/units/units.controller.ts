import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators';
import {
  CreateUnitDto,
  ListUnitsQueryDto,
  UpdateUnitDto,
  UpdateUnitStatusDto,
} from './dto/unit.dto';
import { UnitsService } from './units.service';

@ApiTags('Units')
@ApiCookieAuth()
@Controller('units')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  @RequirePermissions('units.view')
  @ApiOperation({
    summary: 'List units',
    description:
      'Filter by property, building, status, type and rent range. Monetary values are returned as strings.',
  })
  @ApiOkResponse({ description: 'Paginated units.' })
  list(@Query() query: ListUnitsQueryDto) {
    return this.units.list(query);
  }

  @Get('vacant')
  @RequirePermissions('units.view')
  @ApiOperation({ summary: 'Vacant units, for assignment forms' })
  @ApiQuery({ name: 'propertyId', required: false })
  listVacant(@Query('propertyId') propertyId?: string) {
    return this.units.listVacant(propertyId);
  }

  @Get(':id')
  @RequirePermissions('units.view')
  @ApiOperation({ summary: 'One unit' })
  @ApiNotFoundResponse({ description: 'No such unit, or it is outside your scope.' })
  findOne(@Param('id') id: string) {
    return this.units.findOne(id);
  }

  @Post()
  @RequirePermissions('units.create')
  @ApiOperation({ summary: 'Create a unit' })
  @ApiCreatedResponse({ description: 'The created unit.' })
  @ApiConflictResponse({ description: 'That unit number is already used here.' })
  create(@Body() dto: CreateUnitDto) {
    return this.units.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('units.update')
  @ApiOperation({ summary: 'Update a unit' })
  update(@Param('id') id: string, @Body() dto: UpdateUnitDto) {
    return this.units.update(id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('units.update')
  @ApiOperation({
    summary: 'Set a unit status by hand',
    description:
      'RESERVED, MAINTENANCE, UNAVAILABLE or back to VACANT. OCCUPIED is derived from leases and cannot be set here.',
  })
  @ApiConflictResponse({ description: 'The unit is occupied; end the lease instead.' })
  setStatus(@Param('id') id: string, @Body() dto: UpdateUnitStatusDto) {
    return this.units.setStatus(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('units.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a unit' })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiConflictResponse({ description: 'The unit is occupied.' })
  remove(@Param('id') id: string): Promise<void> {
    return this.units.remove(id);
  }
}

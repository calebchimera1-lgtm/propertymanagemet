import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
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
import { BuildingsService } from './buildings.service';
import {
  CreateBuildingDto,
  ListBuildingsQueryDto,
  UpdateBuildingDto,
} from './dto/building.dto';

@ApiTags('Buildings')
@ApiCookieAuth()
@Controller('buildings')
export class BuildingsController {
  constructor(private readonly buildings: BuildingsService) {}

  @Get()
  @RequirePermissions('buildings.view')
  @ApiOperation({ summary: 'List buildings, optionally filtered to one property' })
  @ApiOkResponse({ description: 'Paginated buildings with unit counts.' })
  list(@Query() query: ListBuildingsQueryDto) {
    return this.buildings.list(query);
  }

  @Get(':id')
  @RequirePermissions('buildings.view')
  @ApiOperation({ summary: 'One building' })
  @ApiNotFoundResponse({ description: 'No such building, or it is outside your scope.' })
  findOne(@Param('id') id: string) {
    return this.buildings.findOne(id);
  }

  @Post()
  @RequirePermissions('buildings.create')
  @ApiOperation({ summary: 'Create a building inside a property' })
  @ApiCreatedResponse({ description: 'The created building.' })
  @ApiConflictResponse({ description: 'That name is already used in this property.' })
  create(@Body() dto: CreateBuildingDto) {
    return this.buildings.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('buildings.update')
  @ApiOperation({
    summary: 'Update a building',
    description: 'The parent property cannot be changed — that would relocate every unit beneath it.',
  })
  update(@Param('id') id: string, @Body() dto: UpdateBuildingDto) {
    return this.buildings.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('buildings.delete')
  @ApiOperation({
    summary: 'Delete a building',
    description:
      'Its units are detached to the parent property in the same transaction, never deleted. Returns how many were detached.',
  })
  @ApiOkResponse({ description: '{ detachedUnits: number }' })
  remove(@Param('id') id: string) {
    return this.buildings.remove(id);
  }
}

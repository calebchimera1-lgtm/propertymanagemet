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
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators';
import {
  CreatePropertyDto,
  ListPropertiesQueryDto,
  UpdatePropertyDto,
} from './dto/property.dto';
import { PropertiesService } from './properties.service';

@ApiTags('Properties')
@ApiCookieAuth()
@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get()
  @RequirePermissions('properties.view')
  @ApiOperation({
    summary: 'List properties',
    description:
      'Scoped to the organization, and for caretakers and accountants further scoped to their assigned properties. Archived properties are excluded unless status=ARCHIVED is requested.',
  })
  @ApiOkResponse({ description: 'Paginated properties with building and unit counts.' })
  list(@Query() query: ListPropertiesQueryDto) {
    return this.properties.list(query);
  }

  @Get(':id')
  @RequirePermissions('properties.view')
  @ApiOperation({ summary: 'One property' })
  @ApiNotFoundResponse({ description: 'No such property, or it is outside your scope.' })
  findOne(@Param('id') id: string) {
    return this.properties.findOne(id);
  }

  @Get(':id/summary')
  @RequirePermissions('properties.view')
  @ApiOperation({
    summary: 'Unit counts, occupancy rate and potential monthly rent for one property',
  })
  summary(@Param('id') id: string) {
    return this.properties.summary(id);
  }

  @Post()
  @RequirePermissions('properties.create')
  @ApiOperation({ summary: 'Create a property' })
  @ApiCreatedResponse({ description: 'The created property.' })
  @ApiConflictResponse({ description: 'A property with that name already exists.' })
  create(@Body() dto: CreatePropertyDto) {
    return this.properties.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('properties.update')
  @ApiOperation({ summary: 'Update a property' })
  update(@Param('id') id: string, @Body() dto: UpdatePropertyDto) {
    return this.properties.update(id, dto);
  }

  @Post(':id/archive')
  @RequirePermissions('properties.update')
  @ApiOperation({
    summary: 'Archive a property',
    description: 'The reversible alternative to deletion. Archived properties keep all their history.',
  })
  archive(@Param('id') id: string) {
    return this.properties.archive(id);
  }

  @Delete(':id')
  @RequirePermissions('properties.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Permanently delete an empty property',
    description: 'Refused with 409 while the property still has buildings or units. Archive instead.',
  })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiConflictResponse({ description: 'The property still has buildings or units.' })
  remove(@Param('id') id: string): Promise<void> {
    return this.properties.remove(id);
  }
}

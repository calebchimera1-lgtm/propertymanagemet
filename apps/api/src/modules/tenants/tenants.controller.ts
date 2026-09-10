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
import { CreateTenantDto, ListTenantsQueryDto, UpdateTenantDto } from './dto/tenant.dto';
import { TenantsService } from './tenants.service';

@ApiTags('Tenants')
@ApiCookieAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  @RequirePermissions('tenants.view')
  @ApiOperation({
    summary: 'List tenants',
    description:
      'Each row carries the tenant’s current lease, if any. Property-scoped users see only tenants leasing in their assigned properties.',
  })
  @ApiOkResponse({ description: 'Paginated tenants.' })
  list(@Query() query: ListTenantsQueryDto) {
    return this.tenants.list(query);
  }

  @Get(':id')
  @RequirePermissions('tenants.view')
  @ApiOperation({ summary: 'One tenant' })
  @ApiNotFoundResponse({ description: 'No such tenant, or outside your scope.' })
  findOne(@Param('id') id: string) {
    return this.tenants.findOne(id);
  }

  @Get(':id/profile')
  @RequirePermissions('tenants.view')
  @ApiOperation({
    summary: 'Tenant 360 profile',
    description:
      'Details, current lease, full lease history, rent charged and paid to date, and the most recent payments.',
  })
  profile(@Param('id') id: string) {
    return this.tenants.profile(id);
  }

  @Post()
  @RequirePermissions('tenants.create')
  @ApiOperation({ summary: 'Create a tenant' })
  @ApiCreatedResponse({ description: 'The created tenant.' })
  @ApiConflictResponse({ description: 'That ID number is already on file.' })
  create(@Body() dto: CreateTenantDto) {
    return this.tenants.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('tenants.update')
  @ApiOperation({ summary: 'Update a tenant, or deactivate them' })
  update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenants.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('tenants.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a tenant who has no lease history',
    description: 'Refused with 409 once any lease exists. Deactivate instead.',
  })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiConflictResponse({ description: 'The tenant has lease history.' })
  remove(@Param('id') id: string): Promise<void> {
    return this.tenants.remove(id);
  }
}

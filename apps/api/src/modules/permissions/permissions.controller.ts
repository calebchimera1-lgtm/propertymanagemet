import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators';
import { PermissionsService } from './permissions.service';

@ApiTags('Permissions')
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  @RequirePermissions('staff.view')
  @ApiOperation({ summary: 'List the permission catalogue' })
  @ApiOkResponse({ description: 'Every permission the platform recognises.' })
  list() {
    return this.permissions.listCatalogue();
  }
}

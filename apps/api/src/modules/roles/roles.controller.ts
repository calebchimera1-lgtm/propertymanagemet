import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators';
import { PermissionsService } from '@/modules/permissions/permissions.service';

@ApiTags('Roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  @RequirePermissions('staff.view')
  @ApiOperation({ summary: 'List assignable roles and the permissions each carries' })
  @ApiOkResponse({ description: 'System roles with their permission keys.' })
  async list() {
    const roles = await this.permissions.listRoles();
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      label: role.label,
      description: role.description,
      permissions: role.permissions.map((link) => link.permission.key),
    }));
  }
}

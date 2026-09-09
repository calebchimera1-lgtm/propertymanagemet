import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators';
import { UpdateOrganizationDto, UpdateSettingsDto } from './dto/organization.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('Organization')
@ApiCookieAuth()
@Controller()
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get('organization')
  @RequirePermissions('settings.view')
  @ApiOperation({ summary: "The signed-in user's organization" })
  @ApiOkResponse({ description: 'Organization profile.' })
  current() {
    return this.organizations.current();
  }

  @Patch('organization')
  @RequirePermissions('organization.update')
  @ApiOperation({ summary: 'Update organization details' })
  update(@Body() dto: UpdateOrganizationDto) {
    return this.organizations.update(dto);
  }

  @Get('settings')
  @RequirePermissions('settings.view')
  @ApiOperation({ summary: 'Organization preferences' })
  settings() {
    return this.organizations.settings();
  }

  @Patch('settings')
  @RequirePermissions('settings.update')
  @ApiOperation({ summary: 'Update organization preferences' })
  updateSettings(@Body() dto: UpdateSettingsDto) {
    return this.organizations.updateSettings(dto);
  }
}

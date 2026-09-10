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
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators';
import {
  AssignPropertiesDto,
  CreateStaffDto,
  ListStaffQueryDto,
  UpdateStaffDto,
} from './dto/staff.dto';
import { StaffService } from './staff.service';

@ApiTags('Staff')
@ApiCookieAuth()
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermissions('staff.view')
  @ApiOperation({ summary: 'Everyone who works here' })
  @ApiOkResponse({ description: 'Paginated staff with roles and property assignments.' })
  list(@Query() query: ListStaffQueryDto) {
    return this.staff.list(query);
  }

  @Get(':id')
  @RequirePermissions('staff.view')
  @ApiOperation({ summary: 'One staff member' })
  @ApiNotFoundResponse({ description: 'No such person in your organization.' })
  findOne(@Param('id') id: string) {
    return this.staff.findOne(id);
  }

  @Get(':id/properties')
  @RequirePermissions('staff.view')
  @ApiOperation({
    summary: 'Which properties this person may see',
    description: 'unrestricted=true means their role covers everything, so the list is not a limit.',
  })
  listProperties(@Param('id') id: string) {
    return this.staff.listProperties(id);
  }

  @Post()
  @RequirePermissions('staff.create')
  @ApiOperation({
    summary: 'Invite a staff member',
    description:
      'Creates the account in INVITED status and returns a one-time set-password link. Email is not delivered in Version 1, so the link is shown to you once and never again.',
  })
  @ApiCreatedResponse({ description: 'The new staff member and the invite link.' })
  @ApiConflictResponse({ description: 'That email address is already registered.' })
  create(@Body() dto: CreateStaffDto) {
    return this.staff.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('staff.update')
  @ApiOperation({
    summary: 'Update a staff member',
    description: 'You cannot change your own role, and the last active owner cannot be demoted.',
  })
  @ApiForbiddenResponse({ description: 'You cannot change your own role.' })
  update(@Param('id') id: string, @Body() dto: UpdateStaffDto) {
    return this.staff.update(id, dto);
  }

  @Put(':id/properties')
  @RequirePermissions('staff.update')
  @ApiOperation({
    summary: 'Replace this person’s property assignments',
    description:
      'PUT, not PATCH: the array is the whole set. An empty array means they see nothing. Takes effect on their next request.',
  })
  assignProperties(@Param('id') id: string, @Body() dto: AssignPropertiesDto) {
    return this.staff.assignProperties(id, dto);
  }

  @Post(':id/activate')
  @RequirePermissions('staff.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore access' })
  activate(@Param('id') id: string) {
    return this.staff.setActive(id, true);
  }

  @Post(':id/deactivate')
  @RequirePermissions('staff.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'End access',
    description: 'Also revokes every open session, so access ends now rather than at cookie expiry.',
  })
  @ApiConflictResponse({ description: 'This is the only active owner.' })
  deactivate(@Param('id') id: string) {
    return this.staff.setActive(id, false);
  }

  @Delete(':id')
  @RequirePermissions('staff.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a staff member',
    description: 'Only for an account with no recorded history. Otherwise deactivate.',
  })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiConflictResponse({ description: 'This person appears in the financial or audit record.' })
  remove(@Param('id') id: string) {
    return this.staff.remove(id);
  }
}

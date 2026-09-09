import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators';
import { ListUsersQueryDto } from './dto/list-users.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiCookieAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('staff.view')
  @ApiOperation({ summary: 'List users in your organization' })
  @ApiOkResponse({ description: 'Paginated user directory.' })
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  @Get(':id')
  @RequirePermissions('staff.view')
  @ApiOperation({ summary: 'One user in your organization' })
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }
}

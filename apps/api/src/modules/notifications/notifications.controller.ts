import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedOnly } from '@/common/decorators';
import { ListNotificationsQueryDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

/**
 * Notifications are personal, so these routes are `@AuthenticatedOnly` rather
 * than permission-gated: every one of them reads or writes only the caller's
 * own rows, and there is no endpoint that can reach anyone else's.
 */
@ApiTags('Notifications')
@ApiCookieAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Your notifications, newest first' })
  @ApiOkResponse({ description: 'Paginated notifications with the unread count.' })
  list(@Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(query);
  }

  @Get('unread-count')
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'How many are unread',
    description: 'Polled by the topbar badge every 60 seconds. No WebSockets in Version 1.',
  })
  unreadCount() {
    return this.notifications.unreadCount();
  }

  @Post(':id/read')
  @AuthenticatedOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark one as read' })
  markRead(@Param('id') id: string) {
    return this.notifications.markRead(id);
  }

  @Post('read-all')
  @AuthenticatedOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark everything read' })
  markAllRead() {
    return this.notifications.markAllRead();
  }
}

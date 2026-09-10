import { Global, Module } from '@nestjs/common';
import { NotificationRecipientsService } from './notification-recipients.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Global because domain modules raise notifications as a side effect of their
 * own work — maintenance, payments, and the scheduled jobs all call in. A
 * second instance would mean a second dedupe policy.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationRecipientsService],
  exports: [NotificationsService, NotificationRecipientsService],
})
export class NotificationsModule {}

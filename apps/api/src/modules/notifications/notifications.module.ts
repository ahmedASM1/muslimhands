import { Module, forwardRef } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [forwardRef(() => AlertsModule)],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

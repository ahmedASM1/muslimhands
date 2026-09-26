import { Module, forwardRef } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { AlertEvaluationService } from './alert-evaluation.service';
import { AlertQueueService } from './alert-queue.service';

@Module({
  imports: [forwardRef(() => NotificationsModule), SettingsModule],
  providers: [AlertEvaluationService, AlertQueueService],
  exports: [AlertEvaluationService, AlertQueueService],
})
export class AlertsModule {}

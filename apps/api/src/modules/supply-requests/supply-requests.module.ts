import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SupplyRequestsController } from './supply-requests.controller';
import { SupplyRequestsService } from './supply-requests.service';

@Module({
  imports: [NotificationsModule],
  controllers: [SupplyRequestsController],
  providers: [SupplyRequestsService],
  exports: [SupplyRequestsService],
})
export class SupplyRequestsModule {}

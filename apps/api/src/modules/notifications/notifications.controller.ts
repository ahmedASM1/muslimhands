import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditAction, PERMISSIONS } from '@mh/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { RequestUser } from '../../common/types/authenticated-request';
import { AuditService } from '../audit/audit.service';
import { AlertEvaluationService } from '../alerts/alert-evaluation.service';
import { NotificationsService } from './notifications.service';

class NotificationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  unreadOnly?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  activeOnly?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  severity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  type?: string;
}

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(
    private readonly service: NotificationsService,
    private readonly alerts: AlertEvaluationService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List notifications for the authenticated user' })
  @RequirePermissions(PERMISSIONS.NOTIFICATION_VIEW)
  async list(@CurrentUser() user: RequestUser, @Query() query: NotificationQueryDto) {
    await this.alerts.evaluateAllDebounced().catch(() => undefined);
    return this.service.list(user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread active notification count' })
  @RequirePermissions(PERMISSIONS.NOTIFICATION_VIEW)
  async unreadCount(@CurrentUser() user: RequestUser) {
    await this.alerts.evaluateAllDebounced().catch(() => undefined);
    return this.service.unreadCount(user.id);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Unread alert summary for dashboards' })
  @RequirePermissions(PERMISSIONS.NOTIFICATION_VIEW)
  async summary(@CurrentUser() user: RequestUser) {
    await this.alerts.evaluateAllDebounced().catch(() => undefined);
    return this.service.summary(user.id);
  }

  @Post('evaluate')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Manually run alert evaluation (admin only)' })
  @RequirePermissions(PERMISSIONS.NOTIFICATION_MANAGE)
  async evaluate(@CurrentUser() user: RequestUser) {
    const results = await this.alerts.evaluateAll();
    await this.audit.record({
      userId: user.id,
      action: AuditAction.RUN_ALERT_EVALUATION,
      entityType: 'AlertEvaluation',
      newValues: { results },
    });
    return results;
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.NOTIFICATION_VIEW)
  get(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.get(id, user.id);
  }

  @Post('read-all')
  @RequirePermissions(PERMISSIONS.NOTIFICATION_VIEW)
  markAll(@CurrentUser() user: RequestUser) {
    return this.service.markAllRead(user.id);
  }

  @Post(':id/read')
  @RequirePermissions(PERMISSIONS.NOTIFICATION_VIEW)
  markRead(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.markRead(id, user.id);
  }
}

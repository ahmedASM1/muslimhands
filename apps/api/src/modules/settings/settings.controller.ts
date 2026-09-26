import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuditAction, PERMISSIONS } from '@mh/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { MailerService } from '../../common/mailer/mailer.service';
import type { RequestUser } from '../../common/types/authenticated-request';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from './settings.service';

class UpdateSettingsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  expiryWarningDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  organizationName?: string;
}

class TestEmailDto {
  @IsEmail()
  to: string;
}

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'settings', version: '1' })
export class SettingsController {
  constructor(
    private readonly service: SettingsService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_READ)
  get() {
    return this.service.get();
  }

  @Get('email-status')
  @RequirePermissions(PERMISSIONS.SETTINGS_READ)
  emailStatus() {
    return this.service.emailStatus();
  }

  @Patch()
  @RequirePermissions(PERMISSIONS.SETTINGS_UPDATE)
  async update(@CurrentUser() user: RequestUser, @Body() body: UpdateSettingsDto) {
    const updated = await this.service.update(body);
    await this.audit.record({
      userId: user.id,
      action: AuditAction.UPDATE_SETTINGS,
      entityType: 'AppSetting',
      entityId: user.organizationId ?? user.id,
      newValues: {
        expiryWarningDays: body.expiryWarningDays,
        organizationName: body.organizationName,
      },
    });
    return updated;
  }

  @Post('email/test')
  @RequirePermissions(PERMISSIONS.SETTINGS_UPDATE)
  async sendTestEmail(@CurrentUser() user: RequestUser, @Body() body: TestEmailDto) {
    const result = await this.mailer.sendTestEmail({
      to: body.to,
      requestedByName: user.name,
      userId: user.id,
    });
    await this.audit.record({
      userId: user.id,
      action: AuditAction.SEND_TEST_EMAIL,
      entityType: 'EmailLog',
      entityId: result.emailLogId ?? user.id,
      newValues: { to: body.to, queued: result.delivered },
    });
    return {
      queued: result.delivered,
      message: result.delivered
        ? 'Test email queued successfully.'
        : 'Unable to queue test email. Check email configuration.',
      emailLogId: result.emailLogId,
    };
  }
}

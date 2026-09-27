import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { AuditAction, PERMISSIONS } from '@mh/shared';
import { UserStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { RequestUser } from '../../common/types/authenticated-request';
import { AuditService } from '../audit/audit.service';
import { UsersQueryDto } from './dto/users-query.dto';
import { UsersService } from './users.service';

class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsUUID()
  roleId: string;

  @IsOptional()
  @IsUUID()
  pharmacyId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsUUID()
  roleId?: string;

  @IsOptional()
  @IsUUID()
  pharmacyId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

class UpdateUserStatusDto {
  @IsEnum(UserStatus)
  status: UserStatus;
}

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;
}

class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  inAppEnabled?: boolean;

  @IsOptional()
  @IsIn(['EN', 'AR'])
  preferredLanguage?: 'EN' | 'AR';

  @IsOptional()
  @IsBoolean()
  emailLowStock?: boolean;

  @IsOptional()
  @IsBoolean()
  emailExpiringSoon?: boolean;

  @IsOptional()
  @IsBoolean()
  emailExpiredStock?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  expiryAlertValue?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsIn(['DAYS', 'WEEKS', 'MONTHS'])
  expiryAlertUnit?: 'DAYS' | 'WEEKS' | 'MONTHS' | null;
}

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Get('me')
  getMe(@CurrentUser() user: RequestUser) {
    return this.usersService.getMe(user.id);
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: RequestUser, @Body() dto: UpdateProfileDto) {
    const updated = await this.usersService.updateMe(user.id, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
    });
    await this.audit.record({
      userId: user.id,
      action: AuditAction.UPDATE_PROFILE,
      entityType: 'User',
      entityId: user.id,
      newValues: {
        firstName: updated.firstName,
        lastName: updated.lastName,
        phone: updated.phone,
      },
    });
    return updated;
  }

  @Get('me/notification-preferences')
  getMyNotificationPreferences(@CurrentUser() user: RequestUser) {
    return this.usersService.getNotificationPreferences(user.id);
  }

  @Patch('me/notification-preferences')
  async updateMyNotificationPreferences(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    const prefs = await this.usersService.updateNotificationPreferences(user.id, dto);
    await this.audit.record({
      userId: user.id,
      action: AuditAction.UPDATE_NOTIFICATION_PREFERENCES,
      entityType: 'NotificationPreference',
      entityId: user.id,
      newValues: prefs,
    });
    return prefs;
  }

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_READ)
  list(@Query() query: UsersQueryDto, @CurrentUser() user: RequestUser) {
    return this.usersService.list(query, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USERS_CREATE)
  create(@Body() dto: CreateUserDto, @CurrentUser() user: RequestUser) {
    return this.usersService.create(dto, user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USERS_READ)
  getById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.usersService.getById(id, user);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USERS_UPDATE)
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: RequestUser) {
    return this.usersService.update(id, dto, user);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.USERS_UPDATE)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.usersService.updateStatus(id, dto.status, user);
  }

  @Post(':id/deactivate')
  @RequirePermissions(PERMISSIONS.USERS_UPDATE)
  deactivate(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.usersService.deactivate(id, user);
  }
}

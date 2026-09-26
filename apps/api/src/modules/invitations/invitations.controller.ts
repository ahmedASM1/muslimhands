import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PERMISSIONS } from '@mh/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { RequestUser } from '../../common/types/authenticated-request';
import { InvitationsService } from './invitations.service';

class CreateInvitationDto {
  @IsEmail()
  @MaxLength(200)
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @IsUUID()
  roleId: string;

  @IsOptional()
  @IsUUID()
  pharmacyId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

class AcceptInvitationDto {
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password: string;
}

@ApiTags('invitations')
@Controller({ path: 'invitations', version: '1' })
export class InvitationsController {
  constructor(private readonly service: InvitationsService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get()
  @RequirePermissions(PERMISSIONS.INVITATIONS_READ)
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Post()
  @RequirePermissions(PERMISSIONS.INVITATIONS_CREATE)
  create(@Body() dto: CreateInvitationDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Get(':token')
  preview(@Param('token') token: string) {
    return this.service.preview(token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post(':token/accept')
  accept(@Param('token') token: string, @Body() dto: AcceptInvitationDto) {
    return this.service.accept(token, dto.password);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Post(':id/resend')
  @RequirePermissions(PERMISSIONS.INVITATIONS_CREATE)
  resend(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.resend(id, user);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Post(':id/revoke')
  @RequirePermissions(PERMISSIONS.INVITATIONS_REVOKE)
  revoke(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.revoke(id, user);
  }
}

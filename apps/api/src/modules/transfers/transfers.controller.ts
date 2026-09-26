import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { PERMISSIONS } from '@mh/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { RequestUser } from '../../common/types/authenticated-request';
import { TransferQueryDto, TransfersService } from './transfers.service';

class TransferItemDto {
  @IsUUID()
  medicineId: string;

  @IsUUID()
  batchId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

class CreateTransferDto {
  @IsUUID()
  warehouseId: string;

  @IsUUID()
  pharmacyId: string;

  @IsOptional()
  @IsUUID()
  supplyRequestId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TransferItemDto)
  items: TransferItemDto[];
}

class UpdateTransferDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TransferItemDto)
  items?: TransferItemDto[];
}

@ApiTags('transfers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'transfers', version: '1' })
export class TransfersController {
  constructor(private readonly service: TransfersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSFER_VIEW)
  list(@CurrentUser() user: RequestUser, @Query() query: TransferQueryDto) {
    return this.service.list(user, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSFER_VIEW)
  get(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.get(id, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TRANSFER_CREATE)
  create(@Body() dto: CreateTransferDto, @CurrentUser() user: RequestUser) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TRANSFER_EDIT)
  update(@Param('id') id: string, @Body() dto: UpdateTransferDto, @CurrentUser() user: RequestUser) {
    return this.service.update(id, user, dto);
  }

  @Post(':id/prepare')
  @RequirePermissions(PERMISSIONS.TRANSFER_PREPARE)
  prepare(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.prepare(id, user);
  }

  @Post(':id/ship')
  @RequirePermissions(PERMISSIONS.TRANSFER_SHIP)
  ship(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.ship(id, user);
  }

  /** @deprecated Prefer POST :id/ship — kept for compatibility with IN_TRANSIT naming */
  @Post(':id/dispatch')
  @RequirePermissions(PERMISSIONS.TRANSFER_SHIP)
  dispatch(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.ship(id, user);
  }

  @Post(':id/receive')
  @RequirePermissions(PERMISSIONS.TRANSFER_RECEIVE)
  receive(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.receive(id, user);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.TRANSFER_CANCEL)
  cancel(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.cancel(id, user);
  }
}

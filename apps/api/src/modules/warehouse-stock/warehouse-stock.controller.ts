import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
import { PERMISSIONS } from '@mh/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { RequestUser } from '../../common/types/authenticated-request';
import {
  type AdjustmentDirection,
  type AdjustmentReason,
} from '../../common/inventory/inventory-transaction.service';
import { WarehouseStockQueryDto, WarehouseStockService } from './warehouse-stock.service';

class AdjustStockDto {
  @IsUUID()
  warehouseId: string;

  @IsUUID()
  medicineId: string;

  @IsUUID()
  batchId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @IsIn(['IN', 'OUT'])
  direction: AdjustmentDirection;

  @IsIn(['PHYSICAL_COUNT', 'DAMAGE', 'EXPIRED', 'LOST', 'CORRECTION'])
  reason: AdjustmentReason;

  @IsOptional()
  @IsString()
  notes?: string;
}

class DamageStockDto {
  @IsUUID()
  warehouseId: string;

  @IsUUID()
  medicineId: string;

  @IsUUID()
  batchId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @IsString()
  @MinLength(3)
  notes: string;
}

class ExpireStockDto {
  @IsUUID()
  warehouseId: string;

  @IsUUID()
  medicineId: string;

  @IsUUID()
  batchId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

@ApiTags('warehouse-stock')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'warehouse-stock', version: '1' })
export class WarehouseStockController {
  constructor(private readonly service: WarehouseStockService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WAREHOUSE_STOCK_VIEW)
  list(@Query() query: WarehouseStockQueryDto) {
    return this.service.list(query);
  }

  @Get('summary')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_STOCK_VIEW)
  summary(@Query('warehouseId') warehouseId?: string) {
    return this.service.summary(warehouseId);
  }

  @Get('medicines/:medicineId')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_STOCK_VIEW)
  medicineDetails(
    @Param('medicineId') medicineId: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.service.medicineDetails(medicineId, warehouseId);
  }

  @Post('adjust')
  @RequirePermissions(PERMISSIONS.WAREHOUSE_STOCK_ADJUST)
  adjust(@Body() dto: AdjustStockDto, @CurrentUser() user: RequestUser) {
    return this.service.adjust(user, dto);
  }

  @Post('damage')
  @RequirePermissions(PERMISSIONS.STOCK_DAMAGE)
  damage(@Body() dto: DamageStockDto, @CurrentUser() user: RequestUser) {
    return this.service.markDamaged(user, dto);
  }

  @Post('expire')
  @RequirePermissions(PERMISSIONS.STOCK_EXPIRE)
  expire(@Body() dto: ExpireStockDto, @CurrentUser() user: RequestUser) {
    return this.service.markExpired(user, dto);
  }
}

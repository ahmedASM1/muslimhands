import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@mh/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { RequestUser } from '../../common/types/authenticated-request';
import { PharmacyStockQueryDto, PharmacyStockService } from './pharmacy-stock.service';

@ApiTags('pharmacy-stock')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'pharmacy-stock', version: '1' })
export class PharmacyStockController {
  constructor(private readonly service: PharmacyStockService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PHARMACY_STOCK_VIEW)
  list(@CurrentUser() user: RequestUser, @Query() query: PharmacyStockQueryDto) {
    return this.service.list(user, query);
  }

  @Get('summary')
  @RequirePermissions(PERMISSIONS.PHARMACY_STOCK_VIEW)
  summary(@CurrentUser() user: RequestUser, @Query('pharmacyId') pharmacyId?: string) {
    return this.service.summary(user, pharmacyId);
  }

  @Get('fefo')
  @RequirePermissions(PERMISSIONS.PHARMACY_STOCK_VIEW)
  fefo(
    @CurrentUser() user: RequestUser,
    @Query('medicineId') medicineId: string,
    @Query('pharmacyId') pharmacyId?: string,
  ) {
    return this.service.fefoBatches(user, medicineId, pharmacyId);
  }

  @Get('medicines/:medicineId')
  @RequirePermissions(PERMISSIONS.PHARMACY_STOCK_VIEW)
  medicineDetails(
    @CurrentUser() user: RequestUser,
    @Param('medicineId') medicineId: string,
    @Query('pharmacyId') pharmacyId?: string,
  ) {
    return this.service.medicineDetails(user, medicineId, pharmacyId);
  }
}

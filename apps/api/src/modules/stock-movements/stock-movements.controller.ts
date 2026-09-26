import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@mh/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { RequestUser } from '../../common/types/authenticated-request';
import { StockMovementQueryDto, StockMovementsService } from './stock-movements.service';

@ApiTags('stock-movements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'stock-movements', version: '1' })
export class StockMovementsController {
  constructor(private readonly service: StockMovementsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.STOCK_MOVEMENT_VIEW)
  list(@CurrentUser() user: RequestUser, @Query() query: StockMovementQueryDto) {
    return this.service.list(query, user);
  }
}

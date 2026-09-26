import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { PERMISSIONS } from '@mh/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { RequestUser } from '../../common/types/authenticated-request';
import {
  BeneficiaryReportQueryDto,
  DispensingReportQueryDto,
  ExportQueryDto,
  ReceiptReportQueryDto,
  ReportBaseQueryDto,
  StockMovementReportQueryDto,
  SupplyRequestReportQueryDto,
  TransferReportQueryDto,
} from './dto/report-query.dto';
import { ReportsService } from './reports.service';
import { scopedPharmacyId } from './report-access';
import type { ExportFormat } from './types/report.types';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Global report dashboard',
    description:
      'Current stock metrics are point-in-time. Period activity uses inclusive UTC date range (dateFrom/dateTo or period=TODAY|7D|30D).',
  })
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  overview(@CurrentUser() user: RequestUser, @Query() query: ReportBaseQueryDto) {
    return this.service.overview(user, query);
  }

  @Get('inventory')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  inventory(@CurrentUser() user: RequestUser, @Query() query: ReportBaseQueryDto) {
    return this.service.inventory(user, query);
  }

  @Get('inventory/summary')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  inventorySummary(@CurrentUser() user: RequestUser, @Query() query: ReportBaseQueryDto) {
    return this.service.inventorySummary(user, query);
  }

  @Get('stock-movements')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  stockMovements(
    @CurrentUser() user: RequestUser,
    @Query() query: StockMovementReportQueryDto,
  ) {
    return this.service.stockMovements(user, query);
  }

  @Get('receipts')
  @RequirePermissions(PERMISSIONS.REPORTS_WAREHOUSE)
  receipts(@CurrentUser() user: RequestUser, @Query() query: ReceiptReportQueryDto) {
    return this.service.receipts(user, query);
  }

  @Get('warehouse-stock')
  @RequirePermissions(PERMISSIONS.REPORTS_WAREHOUSE)
  warehouseStock(@CurrentUser() user: RequestUser, @Query() query: ReportBaseQueryDto) {
    return this.service.warehouseStock(user, query);
  }

  @Get('pharmacy-stock')
  @RequirePermissions(PERMISSIONS.REPORTS_PHARMACY)
  pharmacyStock(@CurrentUser() user: RequestUser, @Query() query: ReportBaseQueryDto) {
    return this.service.pharmacyStock(user, query);
  }

  @Get('supply-requests')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  supplyRequests(
    @CurrentUser() user: RequestUser,
    @Query() query: SupplyRequestReportQueryDto,
  ) {
    return this.service.supplyRequests(user, query);
  }

  @Get('transfers')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  transfers(@CurrentUser() user: RequestUser, @Query() query: TransferReportQueryDto) {
    return this.service.transfers(user, query);
  }

  @Get('dispensing')
  @RequirePermissions(PERMISSIONS.REPORTS_DISPENSING)
  dispensing(@CurrentUser() user: RequestUser, @Query() query: DispensingReportQueryDto) {
    return this.service.dispensing(user, query);
  }

  @Get('dispensing/summary')
  @RequirePermissions(PERMISSIONS.REPORTS_DISPENSING)
  dispensingSummary(
    @CurrentUser() user: RequestUser,
    @Query() query: DispensingReportQueryDto,
  ) {
    return this.service.dispensingSummary(user, query);
  }

  @Get('beneficiaries')
  @RequirePermissions(PERMISSIONS.BENEFICIARY_VIEW)
  beneficiaries(
    @CurrentUser() user: RequestUser,
    @Query() query: BeneficiaryReportQueryDto,
  ) {
    return this.service.beneficiaries(user, query);
  }

  @Get('expiry')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  expiry(@CurrentUser() user: RequestUser, @Query() query: ReportBaseQueryDto) {
    return this.service.expiry(user, query);
  }

  @Get('low-stock')
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  lowStock(@CurrentUser() user: RequestUser, @Query() query: ReportBaseQueryDto) {
    return this.service.lowStock(user, query);
  }

  @Get(':reportType/export')
  @ApiOperation({ summary: 'Export a report (csv|xlsx|pdf) using the same filters as the list API' })
  @ApiParam({
    name: 'reportType',
    enum: [
      'inventory',
      'warehouse-stock',
      'pharmacy-stock',
      'stock-movements',
      'receipts',
      'supply-requests',
      'transfers',
      'dispensing',
      'beneficiaries',
      'expiry',
      'low-stock',
    ],
  })
  @ApiProduces(
    'text/csv',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @RequirePermissions(PERMISSIONS.REPORT_EXPORT)
  async export(
    @Param('reportType') reportType: string,
    @Query() query: ReportBaseQueryDto & ExportQueryDto & Record<string, string>,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ) {
    const format = (query.format ?? 'csv') as ExportFormat;
    const result = await this.service.export(user, reportType, format, query);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    res.send(result.buffer);
  }

  // Legacy endpoints kept for older UI clients
  @Get('warehouse')
  @RequirePermissions(PERMISSIONS.REPORTS_WAREHOUSE)
  warehouseLegacy(
    @Query('period') period = 'THIS_MONTH',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.warehousePeriod(period, from, to);
  }

  @Get('pharmacy')
  @RequirePermissions(PERMISSIONS.REPORTS_PHARMACY)
  pharmacyLegacy(
    @CurrentUser() user: RequestUser,
    @Query('period') period = 'THIS_MONTH',
    @Query('pharmacyId') pharmacyId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.pharmacyPeriod(
      period,
      scopedPharmacyId(user, pharmacyId),
      from,
      to,
    );
  }
}

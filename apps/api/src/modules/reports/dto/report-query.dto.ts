import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ReportBaseQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Inclusive start date (YYYY-MM-DD, UTC day)' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Inclusive end date (YYYY-MM-DD, UTC day)' })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({ enum: ['ALL', 'TODAY', 'CURRENT', '7D', '30D', 'CUSTOM'] })
  @IsOptional()
  @IsString()
  period?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  pharmacyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  medicineId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional({ enum: ['EXPIRED', 'EXPIRING_SOON', 'VALID', 'LOW_STOCK', 'IN_STOCK', 'OUT_OF_STOCK'] })
  @IsOptional()
  @IsString()
  stockStatus?: string;

  @ApiPropertyOptional({ enum: ['EXPIRED', 'EXPIRING_SOON', 'VALID'] })
  @IsOptional()
  @IsString()
  expiryStatus?: string;
}

export class StockMovementReportQueryDto extends ReportBaseQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  movementType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referenceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  referenceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  performedById?: string;
}

export class ReceiptReportQueryDto extends ReportBaseQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiptNumber?: string;
}

export class SupplyRequestReportQueryDto extends ReportBaseQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  requestNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  requestedById?: string;
}

export class TransferReportQueryDto extends ReportBaseQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  transferNumber?: string;
}

export class DispensingReportQueryDto extends ReportBaseQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  beneficiaryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dispensingNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  dispensedById?: string;
}

export class BeneficiaryReportQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  pharmacyId?: string;
}

export class ExportQueryDto {
  @ApiPropertyOptional({ enum: ['csv', 'xlsx', 'pdf'], default: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'xlsx', 'pdf'])
  format?: 'csv' | 'xlsx' | 'pdf' = 'csv';

  @ApiPropertyOptional({ description: 'Max rows for export (default 5000)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  limit?: number = 5000;
}

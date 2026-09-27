import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  MinLength,
} from 'class-validator';
import { DosageForm, PERMISSIONS } from '@mh/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { RequestUser } from '../../common/types/authenticated-request';
import { MedicinesService, MedicineQueryDto } from './medicines.service';

type UploadedSpreadsheet = {
  buffer: Buffer;
  originalname: string;
};

class MedicineDto {
  @IsUUID()
  categoryId: string;

  @IsUUID()
  unitId: string;

  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  genericName?: string;

  @IsOptional()
  @IsString()
  brandName?: string;

  @IsOptional()
  @IsString()
  strength?: string;

  @IsEnum(DosageForm)
  dosageForm: DosageForm;

  @IsOptional()
  @IsString()
  @MinLength(2)
  sku?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9\-.]{5,31}$/, {
    message: 'Barcode must be 6-32 characters using letters, numbers, hyphen, or period',
  })
  barcode?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minimumStock: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  reorderQuantity: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  referenceValue?: number;

  @IsOptional()
  @IsString()
  description?: string;
}

class UpdateMedicineDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  genericName?: string;

  @IsOptional()
  @IsString()
  brandName?: string;

  @IsOptional()
  @IsString()
  strength?: string;

  @IsOptional()
  @IsEnum(DosageForm)
  dosageForm?: DosageForm;

  @IsOptional()
  @IsString()
  @MinLength(2)
  sku?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minimumStock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  reorderQuantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  referenceValue?: number;

  @IsOptional()
  @IsString()
  description?: string;
}

class MedicineStatusDto {
  @IsBoolean()
  isActive: boolean;
}

@ApiTags('medicines')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'medicines', version: '1' })
export class MedicinesController {
  constructor(private readonly service: MedicinesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MEDICINES_READ)
  list(@Query() query: MedicineQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.MEDICINES_READ)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.MEDICINES_CREATE)
  create(@Body() dto: MedicineDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user.id);
  }

  @Post('import')
  @RequirePermissions(PERMISSIONS.MEDICINES_CREATE)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  import(
    @UploadedFile() file: UploadedSpreadsheet | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    return this.service.importFromFile(
      { buffer: file.buffer, originalname: file.originalname },
      user.id,
    );
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.MEDICINES_UPDATE)
  update(@Param('id') id: string, @Body() dto: UpdateMedicineDto, @CurrentUser() user: RequestUser) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.MEDICINES_UPDATE)
  setStatus(@Param('id') id: string, @Body() dto: MedicineStatusDto, @CurrentUser() user: RequestUser) {
    return this.service.setStatus(id, dto.isActive, user.id);
  }
}

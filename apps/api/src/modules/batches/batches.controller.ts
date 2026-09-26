import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { PERMISSIONS } from '@mh/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { RequestUser } from '../../common/types/authenticated-request';
import { BatchesService, BatchQueryDto } from './batches.service';

class BatchDto {
  @IsUUID()
  medicineId: string;

  @IsString()
  @MinLength(1)
  batchNumber: string;

  @IsOptional()
  @IsDateString()
  manufacturingDate?: string;

  @IsDateString()
  expiryDate: string;
}

class UpdateBatchDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  batchNumber?: string;

  @IsOptional()
  @IsDateString()
  manufacturingDate?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}

@ApiTags('batches')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'batches', version: '1' })
export class BatchesController {
  constructor(private readonly service: BatchesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BATCHES_READ)
  list(@Query() query: BatchQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BATCHES_READ)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.BATCHES_CREATE)
  create(@Body() dto: BatchDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BATCHES_UPDATE)
  update(@Param('id') id: string, @Body() dto: UpdateBatchDto, @CurrentUser() user: RequestUser) {
    return this.service.update(id, dto, user.id);
  }
}

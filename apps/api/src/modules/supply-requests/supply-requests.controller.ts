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
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PERMISSIONS } from '@mh/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { RequestUser } from '../../common/types/authenticated-request';
import { SupplyRequestQueryDto, SupplyRequestsService } from './supply-requests.service';

class RequestItemDto {
  @IsUUID()
  medicineId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  requestedQty: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

class CreateRequestDto {
  @IsUUID()
  warehouseId: string;

  @IsOptional()
  @IsUUID()
  pharmacyId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RequestItemDto)
  items: RequestItemDto[];
}

class UpdateRequestDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RequestItemDto)
  items?: RequestItemDto[];
}

class ApproveItemDto {
  @IsUUID()
  id: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  approvedQty: number;
}

class ApproveDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApproveItemDto)
  items?: ApproveItemDto[];
}

class RejectDto {
  @IsString()
  @MinLength(3)
  rejectionReason: string;
}

@ApiTags('supply-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'supply-requests', version: '1' })
export class SupplyRequestsController {
  constructor(private readonly service: SupplyRequestsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SUPPLY_REQUEST_VIEW)
  list(@CurrentUser() user: RequestUser, @Query() query: SupplyRequestQueryDto) {
    return this.service.list(user, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.SUPPLY_REQUEST_VIEW)
  get(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.get(id, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SUPPLY_REQUEST_CREATE)
  create(@Body() dto: CreateRequestDto, @CurrentUser() user: RequestUser) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SUPPLY_REQUEST_EDIT)
  update(@Param('id') id: string, @Body() dto: UpdateRequestDto, @CurrentUser() user: RequestUser) {
    return this.service.update(id, user, dto);
  }

  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.SUPPLY_REQUEST_SUBMIT)
  submit(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.submit(id, user);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.SUPPLY_REQUEST_APPROVE)
  approve(@Param('id') id: string, @Body() dto: ApproveDto, @CurrentUser() user: RequestUser) {
    return this.service.approve(id, user, dto);
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.SUPPLY_REQUEST_REJECT)
  reject(@Param('id') id: string, @Body() dto: RejectDto, @CurrentUser() user: RequestUser) {
    return this.service.reject(id, user, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.SUPPLY_REQUEST_CANCEL)
  cancel(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.cancel(id, user);
  }
}

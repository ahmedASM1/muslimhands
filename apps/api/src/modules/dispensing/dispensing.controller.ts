import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { RequestUser } from '../../common/types/authenticated-request';
import { DispensingService } from './dispensing.service';

class DispenseItemDto {
  @IsUUID()
  medicineId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity: number;
}

class CreateDispensingDto {
  @IsUUID()
  beneficiaryId: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DispenseItemDto)
  items: DispenseItemDto[];
}

class DispensingQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  pharmacyId?: string;

  @IsOptional()
  @IsUUID()
  beneficiaryId?: string;

  @IsOptional()
  @IsUUID()
  medicineId?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

@ApiTags('dispensings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'dispensings', version: '1' })
export class DispensingController {
  constructor(private readonly service: DispensingService) {}

  @Get()
  @ApiOperation({ summary: 'List dispensing records' })
  @RequirePermissions(PERMISSIONS.DISPENSING_VIEW)
  list(@CurrentUser() user: RequestUser, @Query() query: DispensingQueryDto) {
    return this.service.list(user, query);
  }

  @Post()
  @ApiOperation({
    summary: 'Create completed dispensing (atomic FEFO)',
    description:
      'Pharmacy is derived from the authenticated assignment. Client must not send pharmacyId.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Optional key to safely retry the same dispensing request',
  })
  @RequirePermissions(PERMISSIONS.DISPENSING_CREATE)
  create(
    @Body() dto: CreateDispensingDto,
    @CurrentUser() user: RequestUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.service.create(user, dto, idempotencyKey?.trim() || undefined);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get dispensing record' })
  @RequirePermissions(PERMISSIONS.DISPENSING_VIEW)
  get(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.get(user, id);
  }

  @Get(':id/items')
  @ApiOperation({ summary: 'Get dispensing items / batch allocations' })
  @RequirePermissions(PERMISSIONS.DISPENSING_VIEW)
  items(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.getItems(user, id);
  }
}

/** Legacy path kept for existing frontend clients during Phase 5. */
@ApiTags('dispensing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'dispensing', version: '1' })
export class DispensingLegacyController {
  constructor(private readonly service: DispensingService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.DISPENSING_VIEW)
  list(@CurrentUser() user: RequestUser, @Query() query: DispensingQueryDto) {
    return this.service.list(user, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.DISPENSING_CREATE)
  create(
    @Body() dto: CreateDispensingDto,
    @CurrentUser() user: RequestUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.service.create(user, dto, idempotencyKey?.trim() || undefined);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.DISPENSING_VIEW)
  get(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.get(user, id);
  }
}

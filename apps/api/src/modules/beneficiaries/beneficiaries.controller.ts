import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsIn,
  MinLength,
} from 'class-validator';
import { Gender, PERMISSIONS } from '@mh/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { RequestUser } from '../../common/types/authenticated-request';
import { BeneficiariesService } from './beneficiaries.service';

class CreateBeneficiaryDto {
  @IsString()
  @MinLength(1)
  fullName: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  externalReference?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class UpdateBeneficiaryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  externalReference?: string | null;

  @IsOptional()
  @IsString()
  address?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}

class BeneficiaryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  externalReference?: string;

  @IsOptional()
  @IsString()
  beneficiaryNumber?: string;
}

class HistoryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  pharmacyId?: string;
}

@ApiTags('beneficiaries')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'beneficiaries', version: '1' })
export class BeneficiariesController {
  constructor(private readonly service: BeneficiariesService) {}

  @Get()
  @ApiOperation({ summary: 'List beneficiaries' })
  @RequirePermissions(PERMISSIONS.BENEFICIARY_VIEW)
  list(@CurrentUser() user: RequestUser, @Query() query: BeneficiaryQueryDto) {
    return this.service.list(user, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create beneficiary' })
  @RequirePermissions(PERMISSIONS.BENEFICIARY_CREATE)
  create(@Body() dto: CreateBeneficiaryDto, @CurrentUser() user: RequestUser) {
    return this.service.create(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get beneficiary' })
  @RequirePermissions(PERMISSIONS.BENEFICIARY_VIEW)
  get(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.get(user, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update beneficiary' })
  @RequirePermissions(PERMISSIONS.BENEFICIARY_EDIT)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBeneficiaryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.update(user, id, dto);
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Activate beneficiary' })
  @RequirePermissions(PERMISSIONS.BENEFICIARY_ACTIVATE)
  activate(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.activate(user, id);
  }

  @Post(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate beneficiary' })
  @RequirePermissions(PERMISSIONS.BENEFICIARY_DEACTIVATE)
  deactivate(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.deactivate(user, id);
  }

  @Get(':id/dispensing-history')
  @ApiOperation({ summary: 'Beneficiary dispensing history' })
  @RequirePermissions(PERMISSIONS.DISPENSING_HISTORY_VIEW)
  history(
    @Param('id') id: string,
    @Query() query: HistoryQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.dispensingHistory(user, id, query);
  }
}

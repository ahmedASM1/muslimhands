import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import { PERMISSIONS } from '@mh/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { RequestUser } from '../../common/types/authenticated-request';
import { CategoriesService, CategoryQueryDto } from './categories.service';

class CategoryDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

class CategoryStatusDto {
  @IsBoolean()
  isActive: boolean;
}

@ApiTags('categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'categories', version: '1' })
export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CATEGORIES_READ)
  list(@Query() query: CategoryQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CATEGORIES_READ)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATEGORIES_CREATE)
  create(@Body() dto: CategoryDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CATEGORIES_UPDATE)
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto, @CurrentUser() user: RequestUser) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.CATEGORIES_UPDATE)
  setStatus(@Param('id') id: string, @Body() dto: CategoryStatusDto, @CurrentUser() user: RequestUser) {
    return this.service.setStatus(id, dto.isActive, user.id);
  }
}

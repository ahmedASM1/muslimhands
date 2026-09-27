import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import { PERMISSIONS } from '@mh/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { RequestUser } from '../../common/types/authenticated-request';
import { CategoriesService, CategoryQueryDto } from './categories.service';

type UploadedSpreadsheet = {
  buffer: Buffer;
  originalname: string;
};

class CategoryDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  itemType?: string;
}

class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  itemType?: string;
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

  @Get('item-types')
  @RequirePermissions(PERMISSIONS.CATEGORIES_READ)
  listItemTypes() {
    return this.service.listItemTypes();
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

  @Post('import')
  @RequirePermissions(PERMISSIONS.CATEGORIES_CREATE)
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

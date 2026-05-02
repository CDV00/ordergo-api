import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import {
  CreateMenuCategoryDto,
  UpdateMenuCategoryDto,
} from './dto/menu-category.dto';
import {
  CreateMenuItemDto,
  ToggleAvailabilityDto,
  UpdateMenuItemDto,
} from './dto/menu-item.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('Catalog (F&B)')
@ApiBearerAuth()
@Controller()
export class CatalogController {
  constructor(private readonly service: CatalogService) {}

  // ── Categories ──
  @Get('menu-categories')
  listCategories(@Query('venueId') venueId?: string) {
    return this.service.listCategories(venueId === undefined ? undefined : venueId || null);
  }

  @Post('menu-categories')
  @RequirePermissions('menu.manage')
  createCategory(@Body() dto: CreateMenuCategoryDto) {
    return this.service.createCategory(dto);
  }

  @Patch('menu-categories/:id')
  @RequirePermissions('menu.manage')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateMenuCategoryDto) {
    return this.service.updateCategory(id, dto);
  }

  @Delete('menu-categories/:id')
  @HttpCode(204)
  @RequirePermissions('menu.manage')
  async deleteCategory(@Param('id') id: string) {
    await this.service.deleteCategory(id);
  }

  // ── Menu Items ──
  @Get('menu-items')
  listItems(
    @Query('venueId') venueId?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.service.listItems({
      venueId: venueId === undefined ? undefined : venueId || null,
      categoryId,
    });
  }

  @Get('menu-items/:id')
  getItem(@Param('id') id: string) {
    return this.service.getItem(id);
  }

  @Post('menu-items')
  @RequirePermissions('menu.manage')
  createItem(@Body() dto: CreateMenuItemDto) {
    return this.service.createItem(dto);
  }

  @Patch('menu-items/:id')
  @RequirePermissions('menu.manage')
  updateItem(@Param('id') id: string, @Body() dto: UpdateMenuItemDto) {
    return this.service.updateItem(id, dto);
  }

  @Patch('menu-items/:id/availability')
  @RequirePermissions('menu.manage')
  toggleAvailability(@Param('id') id: string, @Body() dto: ToggleAvailabilityDto) {
    return this.service.toggleAvailability(id, dto);
  }

  @Delete('menu-items/:id')
  @HttpCode(204)
  @RequirePermissions('menu.manage')
  async deleteItem(@Param('id') id: string) {
    await this.service.deleteItem(id);
  }
}

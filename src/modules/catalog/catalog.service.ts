import { Injectable } from '@nestjs/common';
import { MenuCategoryRepository } from './repositories/menu-category.repository';
import { MenuItemRepository } from './repositories/menu-item.repository';
import { CreateMenuCategoryDto, UpdateMenuCategoryDto } from './dto/menu-category.dto';
import { CreateMenuItemDto, ToggleAvailabilityDto, UpdateMenuItemDto } from './dto/menu-item.dto';
import { MenuCategoryDoc } from './schemas/menu-category.schema';
import { MenuItemDoc } from './schemas/menu-item.schema';
import { newId } from '../../shared/utils/uuid';

@Injectable()
export class CatalogService {
  constructor(
    private readonly categories: MenuCategoryRepository,
    private readonly items: MenuItemRepository,
  ) {}

  // ─── Categories ───
  async listCategories(venueId?: string | null): Promise<MenuCategoryDoc[]> {
    const filter: Record<string, unknown> = {};
    if (venueId !== undefined) filter.venueId = venueId;
    return this.categories.find(filter, { sort: { displayOrder: 1, createdAt: 1 } });
  }

  async createCategory(dto: CreateMenuCategoryDto): Promise<MenuCategoryDoc> {
    return this.categories.create({
      venueId: dto.venueId ?? null,
      name: dto.name,
      description: dto.description ?? null,
      imageUrl: dto.imageUrl ?? null,
      displayOrder: dto.displayOrder ?? 0,
      isActive: true,
    } as Partial<MenuCategoryDoc>);
  }

  async updateCategory(id: string, dto: UpdateMenuCategoryDto): Promise<MenuCategoryDoc> {
    const set: Record<string, unknown> = {};
    if (dto.name !== undefined) set.name = dto.name;
    if (dto.description !== undefined) set.description = dto.description;
    if (dto.imageUrl !== undefined) set.imageUrl = dto.imageUrl;
    if (dto.displayOrder !== undefined) set.displayOrder = dto.displayOrder;
    if (dto.isActive !== undefined) set.isActive = dto.isActive;
    return this.categories.updateById(id, { $set: set });
  }

  async deleteCategory(id: string): Promise<void> {
    await this.categories.softDelete(id);
  }

  // ─── Menu Items ───
  async listItems(filter: {
    venueId?: string | null;
    categoryId?: string;
  }): Promise<MenuItemDoc[]> {
    const f: Record<string, unknown> = {};
    if (filter.venueId !== undefined) f.venueId = filter.venueId;
    if (filter.categoryId) f.categoryId = filter.categoryId;
    return this.items.find(f, { sort: { displayOrder: 1, createdAt: 1 } });
  }

  async getItem(id: string): Promise<MenuItemDoc> {
    return this.items.findByIdOrFail(id);
  }

  async createItem(dto: CreateMenuItemDto): Promise<MenuItemDoc> {
    const variants =
      dto.variants?.map((v) => ({
        id: v.id ?? newId(),
        name: v.name,
        priceModifier: {
          amount: v.priceModifier.amount,
          currency: v.priceModifier.currency ?? 'VND',
        },
        isDefault: v.isDefault ?? false,
      })) ?? [];

    const toppingGroups =
      dto.toppingGroups?.map((g) => ({
        id: g.id ?? newId(),
        name: g.name,
        minSelect: g.minSelect ?? 0,
        maxSelect: g.maxSelect ?? 1,
        options: g.options.map((o) => ({
          id: o.id ?? newId(),
          name: o.name,
          priceModifier: {
            amount: o.priceModifier.amount,
            currency: o.priceModifier.currency ?? 'VND',
          },
          isAvailable: o.isAvailable ?? true,
        })),
      })) ?? [];

    return this.items.create({
      venueId: dto.venueId ?? null,
      categoryId: dto.categoryId,
      name: dto.name,
      description: dto.description ?? null,
      sku: dto.sku ?? null,
      basePrice: { amount: dto.basePrice.amount, currency: dto.basePrice.currency ?? 'VND' },
      imageUrl: dto.imageUrl ?? null,
      displayOrder: dto.displayOrder ?? 0,
      variants,
      toppingGroups,
      isAvailable: true,
      tags: dto.tags ?? [],
    } as Partial<MenuItemDoc>);
  }

  async updateItem(id: string, dto: UpdateMenuItemDto): Promise<MenuItemDoc> {
    const set: Record<string, unknown> = {};
    if (dto.categoryId !== undefined) set.categoryId = dto.categoryId;
    if (dto.name !== undefined) set.name = dto.name;
    if (dto.description !== undefined) set.description = dto.description;
    if (dto.sku !== undefined) set.sku = dto.sku;
    if (dto.basePrice !== undefined) {
      set.basePrice = { amount: dto.basePrice.amount, currency: dto.basePrice.currency ?? 'VND' };
    }
    if (dto.imageUrl !== undefined) set.imageUrl = dto.imageUrl;
    if (dto.displayOrder !== undefined) set.displayOrder = dto.displayOrder;
    if (dto.isAvailable !== undefined) set.isAvailable = dto.isAvailable;
    if (dto.tags !== undefined) set.tags = dto.tags;
    if (dto.variants !== undefined) {
      set.variants = dto.variants.map((v) => ({
        id: v.id ?? newId(),
        name: v.name,
        priceModifier: {
          amount: v.priceModifier.amount,
          currency: v.priceModifier.currency ?? 'VND',
        },
        isDefault: v.isDefault ?? false,
      }));
    }
    if (dto.toppingGroups !== undefined) {
      set.toppingGroups = dto.toppingGroups.map((g) => ({
        id: g.id ?? newId(),
        name: g.name,
        minSelect: g.minSelect ?? 0,
        maxSelect: g.maxSelect ?? 1,
        options: g.options.map((o) => ({
          id: o.id ?? newId(),
          name: o.name,
          priceModifier: {
            amount: o.priceModifier.amount,
            currency: o.priceModifier.currency ?? 'VND',
          },
          isAvailable: o.isAvailable ?? true,
        })),
      }));
    }
    return this.items.updateById(id, { $set: set });
  }

  async toggleAvailability(id: string, dto: ToggleAvailabilityDto): Promise<MenuItemDoc> {
    return this.items.updateById(id, {
      $set: {
        isAvailable: dto.isAvailable,
        unavailableReason: dto.isAvailable ? null : (dto.unavailableReason ?? null),
      },
    });
  }

  async deleteItem(id: string): Promise<void> {
    await this.items.softDelete(id);
  }
}

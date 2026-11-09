import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { MenuCategoryRepository } from './repositories/menu-category.repository';
import { MenuItemRepository } from './repositories/menu-item.repository';
import { CreateMenuCategoryDto, UpdateMenuCategoryDto } from './dto/menu-category.dto';
import { CreateMenuItemDto, ToggleAvailabilityDto, UpdateMenuItemDto } from './dto/menu-item.dto';
import { MenuCategoryDoc } from './schemas/menu-category.schema';
import { MenuItemDoc } from './schemas/menu-item.schema';
import { newId } from '../../shared/utils/uuid';
import { CopyMenuDto } from './dto/copy-menu.dto';
import { buildMenuCopy } from './menu-copy';
import { VenueRepository } from '../tenant/repositories/venue.repository';
import { canAccessVenue, TenantAccessService } from '../tenant/tenant-access.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../audit/audit.module';

export interface CopyMenuResult {
  categories: number;
  items: number;
  /** Số món cũ của cơ sở đích đã bị xoá mềm (khi `replace`). */
  replacedItems: number;
}

/**
 * Lọc theo cơ sở: `undefined` = mọi cơ sở; `null`/'' = chỉ menu dùng chung toàn chuỗi;
 * id = menu của cơ sở đó + menu dùng chung (venueId=null) vẫn hiện ở mọi cơ sở.
 */
export function venueFilter(venueId: string | null | undefined): Record<string, unknown> {
  if (venueId === undefined) return {};
  if (!venueId) return { venueId: null };
  return { venueId: { $in: [venueId, null] } };
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly categories: MenuCategoryRepository,
    private readonly items: MenuItemRepository,
    private readonly venues: VenueRepository,
    private readonly access: TenantAccessService,
    private readonly tenantCtx: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  // ─── Categories ───
  async listCategories(venueId?: string | null): Promise<MenuCategoryDoc[]> {
    return this.categories.find(venueFilter(venueId), { sort: { displayOrder: 1, createdAt: 1 } });
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
    const f: Record<string, unknown> = venueFilter(filter.venueId);
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

  // ─── Sao chép menu giữa các cơ sở ───

  /**
   * Chép nhóm + món riêng của cơ sở `fromVenueId` sang cơ sở `targetVenueId` (id mới, giữ ảnh).
   * Menu dùng chung (venueId=null) không chép — vốn đã hiện ở mọi cơ sở.
   * Cơ sở đích đã có món → 409 MENU_NOT_EMPTY, trừ khi `replace` (xoá mềm menu cũ trước).
   */
  async copyMenu(targetVenueId: string, dto: CopyMenuDto): Promise<CopyMenuResult> {
    if (dto.fromVenueId === targetVenueId) {
      throw new BadRequestException({
        code: 'SAME_VENUE',
        message: 'Cơ sở nguồn và cơ sở đích phải khác nhau.',
      });
    }
    // Cả 2 cơ sở phải thuộc tenant hiện tại (repository tự lọc tenant → 404 nếu không).
    await this.venues.findByIdOrFail(targetVenueId);
    await this.venues.findByIdOrFail(dto.fromVenueId);

    const scope = await this.access.venueScope(this.tenantCtx.userId(), this.tenantCtx.tenantId());
    for (const id of [targetVenueId, dto.fromVenueId]) {
      if (!canAccessVenue(scope, id)) {
        throw new ForbiddenException({
          code: 'VENUE_ACCESS_DENIED',
          message: 'Bạn không có quyền truy cập cơ sở này.',
          details: { venueId: id },
        });
      }
    }

    // Nhóm rỗng cũng tính là "đã có menu" để không sinh nhóm trùng tên.
    const [existing, existingCategories] = await Promise.all([
      this.items.count({ venueId: targetVenueId }),
      this.categories.count({ venueId: targetVenueId }),
    ]);
    if ((existing > 0 || existingCategories > 0) && !dto.replace) {
      throw new ConflictException({
        code: 'MENU_NOT_EMPTY',
        message: 'Cơ sở này đã có menu. Chọn "Thay thế" để xoá menu cũ rồi sao chép.',
        details: { items: existing, categories: existingCategories },
      });
    }

    const sort = { sort: { displayOrder: 1 as const, createdAt: 1 as const } };
    const [categories, items] = await Promise.all([
      this.categories.find({ venueId: dto.fromVenueId }, sort),
      this.items.find({ venueId: dto.fromVenueId }, sort),
    ]);
    const plan = buildMenuCopy({ categories, items }, targetVenueId, newId);

    let replacedItems = 0;
    if (dto.replace) {
      replacedItems = await this.items.softDeleteMany({ venueId: targetVenueId });
      await this.categories.softDeleteMany({ venueId: targetVenueId });
    }
    await this.categories.createMany(plan.categories);
    await this.items.createMany(plan.items);

    const result: CopyMenuResult = {
      categories: plan.categories.length,
      items: plan.items.length,
      replacedItems,
    };
    await this.audit.record({
      action: 'menu.copy',
      entityType: 'venue',
      entityId: targetVenueId,
      metadata: { ...result },
    });
    return result;
  }
}

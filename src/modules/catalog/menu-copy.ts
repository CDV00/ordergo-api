import type { MenuCategoryDoc } from './schemas/menu-category.schema';
import type { MenuItemDoc } from './schemas/menu-item.schema';

/** Trường hệ thống không chép sang bản sao (repository tự đóng dấu lại). */
type SystemFields =
  | 'tenantId'
  | 'createdAt'
  | 'updatedAt'
  | 'createdBy'
  | 'updatedBy'
  | 'deletedAt'
  | 'schemaVersion';

export type CategoryCopy = Omit<MenuCategoryDoc, SystemFields>;
export type ItemCopy = Omit<MenuItemDoc, SystemFields>;

export interface MenuCopyPlan {
  categories: CategoryCopy[];
  items: ItemCopy[];
  /** id nhóm nguồn → id nhóm mới. */
  categoryIdMap: Map<string, string>;
}

/**
 * Dựng bản sao menu của 1 cơ sở cho cơ sở `targetVenueId` (hàm thuần — dễ test):
 *  - Nhóm & món mới có id mới; biến thể / nhóm topping / lựa chọn topping cũng có id mới
 *    (đơn cũ snapshot theo id nên không được dùng chung id giữa 2 cơ sở).
 *  - `categoryId` của món trỏ sang nhóm mới; nếu món nằm trong nhóm không thuộc cơ sở nguồn
 *    (vd nhóm dùng chung toàn chuỗi, venueId=null) thì giữ nguyên nhóm đó.
 *  - `parentCategoryId` được ánh xạ theo cùng quy tắc.
 *  - Giữ nguyên ảnh, giá, tag, thứ tự. Tình trạng "hết món" là theo từng cơ sở → bản sao luôn còn bán.
 */
export function buildMenuCopy(
  source: { categories: MenuCategoryDoc[]; items: MenuItemDoc[] },
  targetVenueId: string,
  genId: () => string,
): MenuCopyPlan {
  const categoryIdMap = new Map<string, string>();
  for (const c of source.categories) categoryIdMap.set(c.id, genId());
  const mapCategory = (id: string | null) => (id ? (categoryIdMap.get(id) ?? id) : null);

  const categories: CategoryCopy[] = source.categories.map((c) => ({
    id: categoryIdMap.get(c.id)!,
    venueId: targetVenueId,
    name: c.name,
    description: c.description ?? null,
    imageUrl: c.imageUrl ?? null,
    displayOrder: c.displayOrder ?? 0,
    isActive: c.isActive ?? true,
    parentCategoryId: mapCategory(c.parentCategoryId ?? null),
  }));

  const items: ItemCopy[] = source.items.map((i) => ({
    id: genId(),
    venueId: targetVenueId,
    categoryId: mapCategory(i.categoryId)!,
    name: i.name,
    description: i.description ?? null,
    sku: i.sku ?? null,
    basePrice: { amount: i.basePrice.amount, currency: i.basePrice.currency ?? 'VND' },
    imageUrl: i.imageUrl ?? null,
    displayOrder: i.displayOrder ?? 0,
    variants: (i.variants ?? []).map((v) => ({
      id: genId(),
      name: v.name,
      priceModifier: {
        amount: v.priceModifier.amount,
        currency: v.priceModifier.currency ?? 'VND',
      },
      isDefault: v.isDefault ?? false,
    })),
    toppingGroups: (i.toppingGroups ?? []).map((g) => ({
      id: genId(),
      name: g.name,
      minSelect: g.minSelect ?? 0,
      maxSelect: g.maxSelect ?? 1,
      options: (g.options ?? []).map((o) => ({
        id: genId(),
        name: o.name,
        priceModifier: {
          amount: o.priceModifier.amount,
          currency: o.priceModifier.currency ?? 'VND',
        },
        isAvailable: o.isAvailable ?? true,
      })),
    })),
    isAvailable: true,
    unavailableReason: null,
    tags: [...(i.tags ?? [])],
  }));

  return { categories, items, categoryIdMap };
}

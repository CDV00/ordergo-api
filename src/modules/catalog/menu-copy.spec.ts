import { buildMenuCopy } from './menu-copy';
import { venueFilter } from './catalog.service';
import type { MenuCategoryDoc } from './schemas/menu-category.schema';
import type { MenuItemDoc } from './schemas/menu-item.schema';

const base = {
  tenantId: 't1',
  schemaVersion: 1,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  createdBy: 'u1',
  updatedBy: 'u1',
  deletedAt: null,
};

const cat = (id: string, extra: Partial<MenuCategoryDoc> = {}): MenuCategoryDoc => ({
  ...base,
  id,
  venueId: 'src',
  name: `Nhóm ${id}`,
  description: null,
  imageUrl: null,
  displayOrder: 0,
  isActive: true,
  parentCategoryId: null,
  ...extra,
});

const item = (id: string, categoryId: string, extra: Partial<MenuItemDoc> = {}): MenuItemDoc => ({
  ...base,
  id,
  venueId: 'src',
  categoryId,
  name: `Món ${id}`,
  description: 'mô tả',
  sku: 'SKU1',
  basePrice: { amount: 29_000, currency: 'VND' },
  imageUrl: '/uploads/t1/a.jpg',
  displayOrder: 3,
  variants: [
    { id: 'v-m', name: 'Size M', priceModifier: { amount: 0, currency: 'VND' }, isDefault: true },
    {
      id: 'v-l',
      name: 'Size L',
      priceModifier: { amount: 6_000, currency: 'VND' },
      isDefault: false,
    },
  ],
  toppingGroups: [
    {
      id: 'g1',
      name: 'Topping',
      minSelect: 0,
      maxSelect: 3,
      options: [
        {
          id: 'o1',
          name: 'Trân châu',
          priceModifier: { amount: 8_000, currency: 'VND' },
          isAvailable: false,
        },
      ],
    },
  ],
  isAvailable: false,
  unavailableReason: 'Hết hàng',
  tags: ['bán chạy'],
  ...extra,
});

function seqIds() {
  let n = 0;
  return () => `new-${++n}`;
}

describe('buildMenuCopy', () => {
  const source = {
    categories: [cat('c1'), cat('c2', { parentCategoryId: 'c1', displayOrder: 1 })],
    items: [item('i1', 'c1'), item('i2', 'c2'), item('i3', 'shared-cat')],
  };
  const plan = buildMenuCopy(source, 'dst', seqIds());

  it('nhóm mới: id mới, đúng cơ sở đích, ánh xạ nhóm cha', () => {
    expect(plan.categories).toHaveLength(2);
    const [c1, c2] = plan.categories;
    expect(c1.id).not.toBe('c1');
    expect(c1.venueId).toBe('dst');
    expect(c1.name).toBe('Nhóm c1');
    expect(c2.parentCategoryId).toBe(c1.id);
    expect(c2.displayOrder).toBe(1);
    expect(plan.categoryIdMap.get('c2')).toBe(c2.id);
  });

  it('món mới trỏ sang nhóm mới; nhóm ngoài cơ sở nguồn (dùng chung) giữ nguyên', () => {
    const [i1, i2, i3] = plan.items;
    expect(i1.categoryId).toBe(plan.categoryIdMap.get('c1'));
    expect(i2.categoryId).toBe(plan.categoryIdMap.get('c2'));
    expect(i3.categoryId).toBe('shared-cat');
    expect(plan.items.every((i) => i.venueId === 'dst')).toBe(true);
  });

  it('id món / biến thể / topping đều mới và không trùng nhau', () => {
    const ids = plan.items.flatMap((i) => [
      i.id,
      ...i.variants.map((v) => v.id),
      ...i.toppingGroups.flatMap((g) => [g.id, ...g.options.map((o) => o.id)]),
    ]);
    const oldIds = ['i1', 'i2', 'i3', 'v-m', 'v-l', 'g1', 'o1'];
    expect(ids.some((id) => oldIds.includes(id))).toBe(false);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('giữ ảnh, giá, biến thể, topping, tag; món luôn còn bán ở cơ sở mới', () => {
    const i1 = plan.items[0];
    expect(i1.imageUrl).toBe('/uploads/t1/a.jpg');
    expect(i1.basePrice).toEqual({ amount: 29_000, currency: 'VND' });
    expect(i1.sku).toBe('SKU1');
    expect(i1.displayOrder).toBe(3);
    expect(i1.tags).toEqual(['bán chạy']);
    expect(i1.variants.map((v) => [v.name, v.priceModifier.amount, v.isDefault])).toEqual([
      ['Size M', 0, true],
      ['Size L', 6_000, false],
    ]);
    expect(i1.toppingGroups[0]).toMatchObject({ name: 'Topping', minSelect: 0, maxSelect: 3 });
    expect(i1.toppingGroups[0].options[0]).toMatchObject({
      name: 'Trân châu',
      priceModifier: { amount: 8_000, currency: 'VND' },
      isAvailable: false,
    });
    expect(i1.isAvailable).toBe(true);
    expect(i1.unavailableReason).toBeNull();
  });

  it('không chép trường hệ thống, không sửa dữ liệu nguồn', () => {
    expect(plan.items[0]).not.toHaveProperty('tenantId');
    expect(plan.items[0]).not.toHaveProperty('createdAt');
    expect(plan.categories[0]).not.toHaveProperty('deletedAt');
    expect(source.items[0].id).toBe('i1');
    expect(source.items[0].variants[0].id).toBe('v-m');
  });

  it('menu nguồn rỗng → bản sao rỗng', () => {
    const empty = buildMenuCopy({ categories: [], items: [] }, 'dst', seqIds());
    expect(empty.categories).toEqual([]);
    expect(empty.items).toEqual([]);
  });
});

describe('venueFilter (danh sách menu)', () => {
  it('không lọc / chỉ dùng chung / cơ sở + dùng chung', () => {
    expect(venueFilter(undefined)).toEqual({});
    expect(venueFilter(null)).toEqual({ venueId: null });
    expect(venueFilter('')).toEqual({ venueId: null });
    expect(venueFilter('v1')).toEqual({ venueId: { $in: ['v1', null] } });
  });
});

import { hasPermission } from './permissions';

describe('hasPermission', () => {
  it('owner * có mọi quyền', () => {
    expect(hasPermission(['*'], 'order.refund')).toBe(true);
  });

  it('khớp chính xác', () => {
    expect(hasPermission(['order.create'], 'order.create')).toBe(true);
    expect(hasPermission(['order.create'], 'order.pay')).toBe(false);
  });

  it('<resource>.manage bao gồm mọi quyền cùng resource', () => {
    expect(hasPermission(['order.manage'], 'order.pay')).toBe(true);
    expect(hasPermission(['order.manage'], 'order.update_kitchen_status')).toBe(true);
    expect(hasPermission(['order.manage'], 'menu.manage')).toBe(false);
    expect(hasPermission(['menu.manage'], 'order.create')).toBe(false);
  });
});

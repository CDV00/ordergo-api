import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { CustomerService, parseBirthday, REVEAL_LIMIT_PER_HOUR } from './customer.service';
import type { CustomerDoc } from './schemas/customer.schema';

/** Query mongoose giả: mọi method chain trả lại chính nó, `exec()` trả `result`. */
function chain(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ['find', 'findOne', 'sort', 'limit', 'select', 'lean']) q[m] = () => q;
  q.exec = () => Promise.resolve(result);
  return q;
}

const baseCustomer = (): CustomerDoc =>
  ({
    id: 'c1',
    tenantId: 't1',
    status: 'verified',
    userId: 'u1',
    cookieAnchor: 'cookie',
    name: 'Trần Thị Lan',
    phone: '+84901234567',
    email: 'lan@example.com',
    birthday: null,
    deviceFingerprints: ['fp'],
    tags: ['VIP'],
    note: 'ghi chú',
    stats: {
      totalSpent: { amount: 100000, currency: 'VND' },
      orderCount: 2,
      firstOrderAt: null,
      lastOrderAt: null,
    },
    consents: {
      marketing: { granted: false, grantedAt: null },
      crossTenantShare: { granted: false, grantedAt: null },
      privacyPolicyAcceptedAt: null,
    },
    dataErasureRequestedAt: null,
    createdAt: new Date(),
  }) as unknown as CustomerDoc;

describe('CustomerService', () => {
  let customer: CustomerDoc;
  let repo: { findByIdOrFail: jest.Mock; updateById: jest.Mock };
  let audit: { record: jest.Mock; countRecent: jest.Mock };
  let orders: { find: jest.Mock; updateMany: jest.Mock };
  let service: CustomerService;

  beforeEach(() => {
    customer = baseCustomer();
    repo = {
      findByIdOrFail: jest.fn().mockImplementation(() => Promise.resolve(customer)),
      updateById: jest
        .fn()
        .mockImplementation((_id: string, patch: { $set: Record<string, unknown> }) =>
          Promise.resolve({ ...customer, ...patch.$set }),
        ),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined), countRecent: jest.fn() };
    orders = {
      find: jest.fn(() => chain([])),
      updateMany: jest.fn(() => ({ exec: () => Promise.resolve({ modifiedCount: 2 }) })),
    };
    const cards = { findOne: jest.fn(() => chain(null)), find: jest.fn(() => chain([])) };
    const txs = { find: jest.fn(() => chain([])) };
    const tenantCtx = { tenantId: () => 't1' };
    service = new CustomerService(
      repo as never,
      cards as never,
      txs as never,
      orders as never,
      audit as never,
      tenantCtx as never,
    );
  });

  describe('reveal', () => {
    it('trả giá trị gốc + ghi audit KHÔNG chứa PII', async () => {
      audit.countRecent.mockResolvedValue(0);
      const res = await service.reveal('c1');
      expect(res.phone).toBe('+84901234567');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'customer.reveal', entityId: 'c1' }),
      );
      const logged = JSON.stringify(audit.record.mock.calls);
      expect(logged).not.toContain('0901234567');
      expect(logged).not.toContain('Lan');
      expect(logged).not.toContain('lan@example.com');
    });

    it(`chặn khi đã xem ${REVEAL_LIMIT_PER_HOUR} lần trong giờ → 429 REVEAL_LIMIT`, async () => {
      audit.countRecent.mockResolvedValue(REVEAL_LIMIT_PER_HOUR);
      await expect(service.reveal('c1')).rejects.toBeInstanceOf(HttpException);
      await service.reveal('c1').catch((e: HttpException) => {
        expect(e.getStatus()).toBe(429);
        expect((e.getResponse() as { code: string }).code).toBe('REVEAL_LIMIT');
      });
      expect(repo.findByIdOrFail).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('khách không tồn tại / khác tenant → 404, không ghi audit', async () => {
      audit.countRecent.mockResolvedValue(0);
      repo.findByIdOrFail.mockRejectedValue(new NotFoundException());
      await expect(service.reveal('x')).rejects.toBeInstanceOf(NotFoundException);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('audit chỉ ghi tên trường thay đổi', async () => {
      const res = await service.update('c1', { name: 'Trần Thị Lan', note: 'Mới', tags: ['VIP'] });
      expect(repo.updateById).toHaveBeenCalledWith('c1', { $set: { note: 'Mới' } });
      expect(audit.record).toHaveBeenCalledWith({
        action: 'customer.update',
        entityType: 'customer',
        entityId: 'c1',
        metadata: { fields: ['note'] },
      });
      expect(res.name).toBe('Trần T** L**');
    });

    it('không đổi gì → không ghi audit', async () => {
      await service.update('c1', { email: 'lan@example.com' });
      expect(repo.updateById).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('khách đã ẩn danh hoá → 409', async () => {
      customer.dataErasureRequestedAt = new Date();
      await expect(service.update('c1', { name: 'A' })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('anonymize xoá PII + định danh gián tiếp, giữ thống kê, xoá snapshot trên đơn', async () => {
    const res = await service.anonymize('c1');
    const set = (repo.updateById.mock.calls[0] as [string, { $set: Record<string, unknown> }])[1]
      .$set;
    expect(set).toMatchObject({
      name: null,
      phone: null,
      email: null,
      birthday: null,
      tags: [],
      note: null,
      userId: null,
      cookieAnchor: null,
      deviceFingerprints: [],
      status: 'anonymous',
    });
    expect(set).not.toHaveProperty('stats');
    expect(orders.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', customerId: 'c1' }),
      expect.objectContaining({ $set: expect.objectContaining({ customerSnapshot: null }) }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'customer.anonymize', entityId: 'c1' }),
    );
    expect(res.stats.visits).toBe(2);
    expect(res.name).toBeNull();
  });

  it('parseBirthday chặn ngày tương lai / sai lịch', () => {
    expect(parseBirthday('1990-05-17').toISOString()).toBe('1990-05-17T00:00:00.000Z');
    expect(() => parseBirthday('1990-02-30')).toThrow();
    expect(() => parseBirthday('2999-01-01')).toThrow();
    expect(() => parseBirthday('1850-01-01')).toThrow();
  });
});

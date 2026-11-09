import { HttpException } from '@nestjs/common';
import { IdempotencyService, isValidIdempotencyKey } from './idempotency.service';
import { IdempotencyRecord, IdempotencyStore } from './idempotency.store';

/** Store trong bộ nhớ, mô phỏng unique index (tenantId, key). */
class MemoryStore extends IdempotencyStore {
  readonly rows = new Map<string, IdempotencyRecord>();
  private id = (t: string, k: string) => `${t}|${k}`;

  tryInsert(rec: IdempotencyRecord): Promise<boolean> {
    const id = this.id(rec.tenantId, rec.key);
    if (this.rows.has(id)) return Promise.resolve(false);
    this.rows.set(id, { ...rec });
    return Promise.resolve(true);
  }
  find(tenantId: string, key: string): Promise<IdempotencyRecord | null> {
    return Promise.resolve(this.rows.get(this.id(tenantId, key)) ?? null);
  }
  complete(tenantId: string, key: string, status: number, body: unknown): Promise<void> {
    const row = this.rows.get(this.id(tenantId, key));
    if (row?.state === 'in_progress')
      Object.assign(row, { state: 'completed', status, responseBody: body });
    return Promise.resolve();
  }
  release(tenantId: string, key: string, createdAt?: Date): Promise<void> {
    const row = this.rows.get(this.id(tenantId, key));
    if (
      row?.state === 'in_progress' &&
      (!createdAt || row.createdAt.getTime() === createdAt.getTime())
    ) {
      this.rows.delete(this.id(tenantId, key));
    }
    return Promise.resolve();
  }
}

const KEY = '0193a1c2-1111-7aaa-8bbb-123456789abc';
const req = (over: Partial<Parameters<IdempotencyService['execute']>[0]> = {}) => ({
  tenantId: 't1',
  key: KEY,
  method: 'POST',
  path: '/v1/orders',
  successStatus: 201,
  ...over,
});

async function errorCode(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await p;
  } catch (e) {
    const ex = e as HttpException;
    return { status: ex.getStatus(), code: (ex.getResponse() as { code: string }).code };
  }
  throw new Error('không ném lỗi');
}

describe('IdempotencyService', () => {
  let store: MemoryStore;
  let service: IdempotencyService;

  beforeEach(() => {
    store = new MemoryStore();
    service = new IdempotencyService(store);
    service.configure({ waitMs: 200, pollMs: 10, staleMs: 60_000 });
  });

  it('chạy handler lần đầu, lần gửi lại trả body đã lưu mà không chạy lại', async () => {
    const handler = jest.fn().mockResolvedValue({ id: 'o1', createdAt: new Date(0) });
    const first = await service.execute(req(), handler);
    const second = await service.execute(req(), handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(first).toEqual({
      replayed: false,
      status: 201,
      body: { id: 'o1', createdAt: '1970-01-01T00:00:00.000Z' },
    });
    expect(second).toEqual({ ...first, replayed: true });
  });

  it('cùng key khác path → 422 IDEMPOTENCY_KEY_REUSED', async () => {
    await service.execute(req(), () => Promise.resolve({ id: 'o1' }));
    const other = service.execute(req({ path: '/v1/orders/o1/lines' }), () =>
      Promise.resolve(null),
    );
    expect(await errorCode(other)).toEqual({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('key tách theo tenant', async () => {
    const handler = jest.fn().mockResolvedValue({ ok: true });
    await service.execute(req({ tenantId: 't1' }), handler);
    const r = await service.execute(req({ tenantId: 't2' }), handler);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(r.replayed).toBe(false);
  });

  it('handler lỗi → không lưu, thử lại cùng key sẽ chạy lại', async () => {
    const boom = service.execute(req(), () => Promise.reject(new Error('hết món')));
    await expect(boom).rejects.toThrow('hết món');
    expect(store.rows.size).toBe(0);

    const ok = await service.execute(req(), () => Promise.resolve({ id: 'o2' }));
    expect(ok).toMatchObject({ replayed: false, body: { id: 'o2' } });
  });

  it('request trùng chạy song song → chờ và trả cùng kết quả, handler chạy 1 lần', async () => {
    let release!: (v: unknown) => void;
    const handler = jest.fn(() => new Promise((r) => (release = r)));
    const a = service.execute(req(), handler);
    await new Promise((r) => setTimeout(r, 5));
    const b = service.execute(req(), handler);
    await new Promise((r) => setTimeout(r, 20));
    release({ id: 'o3' });

    const [ra, rb] = await Promise.all([a, b]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(ra.body).toEqual({ id: 'o3' });
    expect(rb).toEqual({ replayed: true, status: 201, body: { id: 'o3' } });
  });

  it('request trùng chờ quá lâu → 409 IDEMPOTENCY_IN_PROGRESS', async () => {
    const a = service.execute(req(), () => new Promise(() => undefined));
    void a;
    await new Promise((r) => setTimeout(r, 5));
    const b = service.execute(req(), () => Promise.resolve(null));
    expect(await errorCode(b)).toEqual({ status: 409, code: 'IDEMPOTENCY_IN_PROGRESS' });
  });

  it('giữ chỗ bị bỏ dở quá staleMs → request mới chiếm lại', async () => {
    await store.tryInsert({
      ...req(),
      state: 'in_progress',
      status: null,
      responseBody: null,
      createdAt: new Date(Date.now() - 120_000),
    });
    const r = await service.execute(req(), () => Promise.resolve({ id: 'o4' }));
    expect(r).toMatchObject({ replayed: false, body: { id: 'o4' } });
  });

  it('key sai định dạng → 400', async () => {
    const r = service.execute(req({ key: 'x' }), () => Promise.resolve(null));
    expect(await errorCode(r)).toEqual({ status: 400, code: 'IDEMPOTENCY_KEY_INVALID' });
    expect(isValidIdempotencyKey(KEY)).toBe(true);
    expect(isValidIdempotencyKey('a b c d e f g h')).toBe(false);
  });
});

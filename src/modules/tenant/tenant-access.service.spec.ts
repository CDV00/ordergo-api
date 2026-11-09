import { ForbiddenException } from '@nestjs/common';
import {
  AccessMembership,
  AccessRequest,
  resolveTenantAccess,
  VenueInTenantCheck,
} from './tenant-access.service';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const VENUE_A1 = 'venue-a1';
const VENUE_A2 = 'venue-a2';
const VENUE_B1 = 'venue-b1';

/** Venue nào thuộc tenant nào — giả lập DB. */
const venuesOf: Record<string, string[]> = {
  [TENANT_A]: [VENUE_A1, VENUE_A2],
  [TENANT_B]: [VENUE_B1],
};
const venueInTenant: VenueInTenantCheck = (tenantId, venueId) =>
  Promise.resolve((venuesOf[tenantId] ?? []).includes(venueId));

const ownerOfA: AccessMembership = { tenantId: TENANT_A, venueId: null, permissions: ['*'] };
const ownerOfB: AccessMembership = { tenantId: TENANT_B, venueId: null, permissions: ['*'] };
const serverAtA1: AccessMembership = {
  tenantId: TENANT_A,
  venueId: VENUE_A1,
  permissions: ['order.create'],
};

function req(partial: Partial<AccessRequest>): AccessRequest {
  return {
    jwtTenantId: null,
    jwtVenueId: null,
    headerTenantId: null,
    headerVenueId: null,
    ...partial,
  };
}

async function expectForbidden(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(ForbiddenException);
  await p.catch((e: ForbiddenException) => {
    expect((e.getResponse() as { code: string }).code).toBe(code);
  });
}

describe('resolveTenantAccess', () => {
  it('chặn owner tenant A đổi header sang tenant B (lỗ hổng cũ)', async () => {
    await expectForbidden(
      resolveTenantAccess(
        [ownerOfA],
        req({ jwtTenantId: TENANT_A, headerTenantId: TENANT_B }),
        venueInTenant,
      ),
      'TENANT_ACCESS_DENIED',
    );
  });

  it('chặn khi JWT mang tenant mà user không còn membership (đã bị thu hồi)', async () => {
    await expectForbidden(
      resolveTenantAccess([], req({ jwtTenantId: TENANT_A }), venueInTenant),
      'TENANT_ACCESS_DENIED',
    );
  });

  it('cho user thuộc cả 2 tenant chuyển tenant bằng header', async () => {
    const r = await resolveTenantAccess(
      [ownerOfA, ownerOfB],
      req({ jwtTenantId: TENANT_A, headerTenantId: TENANT_B }),
      venueInTenant,
    );
    expect(r).toEqual({ tenantId: TENANT_B, venueId: null, permissions: ['*'] });
  });

  it('không trộn venue của JWT (tenant A) khi đã chuyển sang tenant B', async () => {
    const r = await resolveTenantAccess(
      [ownerOfA, ownerOfB],
      req({ jwtTenantId: TENANT_A, jwtVenueId: VENUE_A1, headerTenantId: TENANT_B }),
      venueInTenant,
    );
    expect(r.venueId).toBeNull();
  });

  it('owner chọn venue thuộc tenant mình', async () => {
    const r = await resolveTenantAccess(
      [ownerOfA],
      req({ jwtTenantId: TENANT_A, headerVenueId: VENUE_A2 }),
      venueInTenant,
    );
    expect(r).toEqual({ tenantId: TENANT_A, venueId: VENUE_A2, permissions: ['*'] });
  });

  it('chặn owner tenant A trỏ header venue sang venue của tenant B', async () => {
    await expectForbidden(
      resolveTenantAccess(
        [ownerOfA],
        req({ jwtTenantId: TENANT_A, headerVenueId: VENUE_B1 }),
        venueInTenant,
      ),
      'VENUE_ACCESS_DENIED',
    );
  });

  it('nhân viên gắn venue A1 không vào được venue A2', async () => {
    await expectForbidden(
      resolveTenantAccess(
        [serverAtA1],
        req({ jwtTenantId: TENANT_A, jwtVenueId: VENUE_A1, headerVenueId: VENUE_A2 }),
        venueInTenant,
      ),
      'VENUE_ACCESS_DENIED',
    );
  });

  it('nhân viên gắn venue: không gửi venue thì dùng venue của membership', async () => {
    const r = await resolveTenantAccess(
      [serverAtA1],
      req({ jwtTenantId: TENANT_A }),
      venueInTenant,
    );
    expect(r).toEqual({ tenantId: TENANT_A, venueId: VENUE_A1, permissions: ['order.create'] });
  });

  it('permissions lấy từ membership trong DB, không lấy từ JWT', async () => {
    // JWT có thể còn mang quyền cũ; kết quả chỉ phụ thuộc membership hiện tại.
    const r = await resolveTenantAccess(
      [serverAtA1],
      req({ jwtTenantId: TENANT_A, jwtVenueId: VENUE_A1 }),
      venueInTenant,
    );
    expect(r.permissions).toEqual(['order.create']);
  });

  it('user chưa có doanh nghiệp: không tenant, không quyền', async () => {
    const r = await resolveTenantAccess([], req({}), venueInTenant);
    expect(r).toEqual({ tenantId: null, venueId: null, permissions: [] });
  });
});

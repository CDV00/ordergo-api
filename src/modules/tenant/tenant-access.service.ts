import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MembershipRepository } from './repositories/membership.repository';
import { VenueDoc } from './schemas/venue.schema';

/** Membership tối thiểu cần để quyết định quyền truy cập. */
export interface AccessMembership {
  tenantId: string;
  venueId: string | null;
  permissions: string[];
}

export interface AccessRequest {
  /** Tenant/venue được ký trong JWT. */
  jwtTenantId: string | null;
  jwtVenueId: string | null;
  /** Tenant/venue client yêu cầu qua header X-Tenant-Id / X-Venue-Id (chưa tin cậy). */
  headerTenantId: string | null;
  headerVenueId: string | null;
}

export interface ResolvedAccess {
  tenantId: string | null;
  venueId: string | null;
  permissions: string[];
}

/** Trả về true nếu venue thuộc tenant (và chưa bị xoá). */
export type VenueInTenantCheck = (tenantId: string, venueId: string) => Promise<boolean>;

function tenantDenied(tenantId: string): ForbiddenException {
  return new ForbiddenException({
    code: 'TENANT_ACCESS_DENIED',
    message: 'Bạn không có quyền truy cập doanh nghiệp này.',
    details: { tenantId },
  });
}

function venueDenied(venueId: string): ForbiddenException {
  return new ForbiddenException({
    code: 'VENUE_ACCESS_DENIED',
    message: 'Bạn không có quyền truy cập cơ sở này.',
    details: { venueId },
  });
}

/**
 * Quyết định tenant/venue/permissions hiệu lực cho 1 request.
 *
 * Quy tắc:
 *  - Tenant yêu cầu = header ?? JWT. User PHẢI có membership active ở tenant đó,
 *    nếu không → 403 TENANT_ACCESS_DENIED (chặn đổi header sang tenant người khác).
 *  - Permissions luôn lấy từ membership trong DB, không lấy từ JWT — vừa đúng
 *    tenant đang thao tác, vừa có hiệu lực ngay khi membership bị thu hồi/đổi role.
 *  - Venue yêu cầu = header ?? (JWT venue, chỉ khi JWT cùng tenant).
 *      · Membership toàn tenant (venueId=null): venue phải thuộc tenant.
 *      · Membership gắn venue: chỉ được vào đúng venue đó.
 *  - Không yêu cầu venue: membership toàn tenant → venueId=null; nếu chỉ có
 *    membership gắn venue → dùng venue đầu tiên.
 */
export async function resolveTenantAccess(
  memberships: AccessMembership[],
  req: AccessRequest,
  venueInTenant: VenueInTenantCheck,
): Promise<ResolvedAccess> {
  const tenantId = req.headerTenantId ?? req.jwtTenantId;
  if (!tenantId) {
    // User chưa có doanh nghiệp (vd: trước setup wizard) — không có quyền nghiệp vụ nào.
    return { tenantId: null, venueId: null, permissions: [] };
  }

  const inTenant = memberships.filter((m) => m.tenantId === tenantId);
  if (inTenant.length === 0) throw tenantDenied(tenantId);

  const tenantWide = inTenant.find((m) => m.venueId === null);
  const requestedVenue =
    req.headerVenueId ?? (req.jwtTenantId === tenantId ? req.jwtVenueId : null);

  if (requestedVenue) {
    const venueBound = inTenant.find((m) => m.venueId === requestedVenue);
    if (tenantWide) {
      if (!(await venueInTenant(tenantId, requestedVenue))) throw venueDenied(requestedVenue);
      const permissions = [
        ...new Set([...tenantWide.permissions, ...(venueBound?.permissions ?? [])]),
      ];
      return { tenantId, venueId: requestedVenue, permissions };
    }
    if (venueBound) {
      return { tenantId, venueId: requestedVenue, permissions: [...venueBound.permissions] };
    }
    throw venueDenied(requestedVenue);
  }

  if (tenantWide) {
    return { tenantId, venueId: null, permissions: [...tenantWide.permissions] };
  }
  const first = inTenant[0];
  return { tenantId, venueId: first.venueId, permissions: [...first.permissions] };
}

/** Phạm vi cơ sở từ danh sách membership (đã lọc đúng tenant). */
export function venueScopeOf(memberships: Array<Pick<AccessMembership, 'venueId'>>): {
  tenantWide: boolean;
  venueIds: string[];
} {
  return {
    tenantWide: memberships.some((m) => m.venueId === null),
    venueIds: [
      ...new Set(memberships.map((m) => m.venueId).filter((v): v is string => v !== null)),
    ],
  };
}

/** User có được thao tác trên cơ sở `venueId` không (toàn tenant hoặc được gắn đúng cơ sở). */
export function canAccessVenue(
  scope: { tenantWide: boolean; venueIds: string[] },
  venueId: string,
): boolean {
  return scope.tenantWide || scope.venueIds.includes(venueId);
}

@Injectable()
export class TenantAccessService {
  constructor(
    private readonly memberships: MembershipRepository,
    @InjectModel(VenueDoc.name) private readonly venueModel: Model<VenueDoc>,
  ) {}

  async resolve(userId: string, req: AccessRequest): Promise<ResolvedAccess> {
    const memberships = await this.memberships.findActiveByUser(userId);
    return resolveTenantAccess(memberships, req, (tenantId, venueId) =>
      this.venueExists(tenantId, venueId),
    );
  }

  /**
   * Phạm vi cơ sở của user trong tenant (theo membership active trong DB, không theo header):
   * `tenantWide` = có membership toàn tenant (owner/tenant_admin/kế toán...), `venueIds` = các cơ sở
   * được gắn riêng. Dùng cho thao tác nhiều cơ sở (báo cáo toàn chuỗi, sao chép menu...).
   */
  async venueScope(
    userId: string,
    tenantId: string,
  ): Promise<{ tenantWide: boolean; venueIds: string[] }> {
    const mine = (await this.memberships.findActiveByUser(userId)).filter(
      (m) => m.tenantId === tenantId,
    );
    return venueScopeOf(mine);
  }

  private async venueExists(tenantId: string, venueId: string): Promise<boolean> {
    const found = await this.venueModel.exists({ id: venueId, tenantId, deletedAt: null }).exec();
    return found !== null;
  }
}

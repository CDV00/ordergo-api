import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../audit/audit.module';
import { AuthService } from '../identity/auth.service';
import { UserRepository } from '../identity/repositories/user.repository';
import { MembershipRepository } from '../tenant/repositories/membership.repository';
import { VenueRepository } from '../tenant/repositories/venue.repository';
import { MembershipDoc, ROLE_PERMISSIONS } from '../tenant/schemas/membership.schema';
import { maskPhone } from '../../shared/utils/mask';
import { InviteStaffDto, UpdateStaffDto } from './staff.dto';
import { canManageRole, generateTempPassword } from './staff.rules';

export interface StaffView {
  membershipId: string;
  userId: string;
  displayName: string;
  /** Đã che — nhân viên vẫn là dữ liệu cá nhân */
  phone: string | null;
  roleCode: MembershipDoc['roleCode'];
  venueId: string | null;
  status: MembershipDoc['status'];
  lastLoginAt: Date | null;
  isSelf: boolean;
  canManage: boolean;
}

@Injectable()
export class StaffService {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly users: UserRepository,
    private readonly venues: VenueRepository,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly tenantCtx: TenantContextService,
  ) {}

  async list(): Promise<StaffView[]> {
    const actor = await this.actor();
    let rows = await this.memberships.findByTenant(actor.tenantId);
    // Quản lý gắn 1 cơ sở chỉ thấy nhân viên cơ sở đó
    if (actor.venueId) rows = rows.filter((m) => m.venueId === actor.venueId);
    const users = await Promise.all(rows.map((m) => this.users.findById(m.userId)));
    return rows
      .map((m, i) => this.toView(m, users[i], actor))
      .sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1));
  }

  /**
   * Mời nhân viên. SĐT chưa có tài khoản → tạo tài khoản với mật khẩu tạm, trả về 1 LẦN DUY NHẤT
   * để người mời đưa cho nhân viên (nhân viên đổi ngay sau khi đăng nhập).
   */
  async invite(dto: InviteStaffDto): Promise<{ staff: StaffView; tempPassword: string | null }> {
    const actor = await this.actor();
    this.assertCanManage(actor, dto.roleCode);
    await this.assertVenue(actor, dto.venueId);

    const phone = this.auth.normalizePhone(dto.phone);
    let user = await this.users.findByPhone(phone);
    let tempPassword: string | null = null;
    if (!user) {
      tempPassword = generateTempPassword(randomBytes);
      user = await this.users.create({
        phone,
        displayName: dto.displayName.trim(),
        passwordHash: await argon2.hash(tempPassword, { type: argon2.argon2id }),
      });
    }

    const existing = await this.memberships.findExisting(actor.tenantId, user.id, dto.venueId);
    if (existing) {
      throw new ConflictException({
        code: existing.status === 'revoked' ? 'STAFF_REVOKED' : 'STAFF_EXISTS',
        message:
          existing.status === 'revoked'
            ? 'Người này từng làm ở cơ sở và đã bị khoá — dùng "Mở khoá" thay vì mời lại.'
            : 'Người này đã là nhân viên của cơ sở.',
      });
    }

    const membership = await this.memberships.create({
      tenantId: actor.tenantId,
      userId: user.id,
      venueId: dto.venueId,
      roleCode: dto.roleCode,
      invitedBy: actor.userId,
      status: 'active',
    });
    await this.audit.record({
      action: 'staff.invite',
      entityType: 'Membership',
      entityId: membership.id,
      metadata: { roleCode: dto.roleCode, venueId: dto.venueId, newAccount: !!tempPassword },
    });
    return { staff: this.toView(membership, user, actor), tempPassword };
  }

  async update(membershipId: string, dto: UpdateStaffDto): Promise<StaffView> {
    const actor = await this.actor();
    const target = await this.getManageable(actor, membershipId);
    const set: Parameters<MembershipRepository['updateInTenant']>[2] = {};
    if (dto.roleCode && dto.roleCode !== target.roleCode) {
      this.assertCanManage(actor, dto.roleCode);
      set.roleCode = dto.roleCode;
      set.permissions = ROLE_PERMISSIONS[dto.roleCode];
    }
    if (dto.venueId && dto.venueId !== target.venueId) {
      await this.assertVenue(actor, dto.venueId);
      set.venueId = dto.venueId;
    }
    if (Object.keys(set).length === 0)
      return this.toView(target, await this.users.findById(target.userId), actor);
    const updated = await this.memberships.updateInTenant(actor.tenantId, membershipId, set);
    await this.audit.record({
      action: 'staff.update',
      entityType: 'Membership',
      entityId: membershipId,
      metadata: {
        from: target.roleCode,
        to: set.roleCode ?? target.roleCode,
        venueChanged: !!set.venueId,
      },
    });
    return this.toView(updated!, await this.users.findById(target.userId), actor);
  }

  /** Khoá / mở khoá. Khoá có hiệu lực ngay (JwtAuthGuard kiểm membership mỗi request). */
  async setStatus(membershipId: string, status: 'active' | 'revoked'): Promise<StaffView> {
    const actor = await this.actor();
    const target = await this.getManageable(actor, membershipId);
    const updated = await this.memberships.updateInTenant(actor.tenantId, membershipId, { status });
    await this.audit.record({
      action: status === 'revoked' ? 'staff.revoke' : 'staff.restore',
      entityType: 'Membership',
      entityId: membershipId,
      metadata: { roleCode: target.roleCode },
    });
    return this.toView(updated!, await this.users.findById(target.userId), actor);
  }

  // ─── Nội bộ ────────────────────────────────────────────────────────────

  /** Người thao tác: tenant/user từ context đã xác thực + membership để biết vai trò. */
  private async actor() {
    const ctx = this.tenantCtx.required();
    const tenantId = this.tenantCtx.tenantId();
    const userId = this.tenantCtx.userId();
    const mine = (await this.memberships.findActiveByUser(userId)).filter(
      (m) => m.tenantId === tenantId,
    );
    const tenantWide = mine.find((m) => m.venueId === null);
    const current = tenantWide ?? mine.find((m) => m.venueId === ctx.venueId) ?? mine[0];
    return {
      tenantId,
      userId,
      permissions: ctx.permissions,
      roleCode: current?.roleCode ?? null,
      /** null = toàn tenant */
      venueId: tenantWide ? null : (current?.venueId ?? null),
    };
  }

  private assertCanManage(
    actor: Awaited<ReturnType<StaffService['actor']>>,
    role: MembershipDoc['roleCode'],
  ) {
    if (!canManageRole(actor.permissions, actor.roleCode, role)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Bạn không thể quản lý nhân viên ở vai trò này.',
      });
    }
  }

  private async assertVenue(actor: Awaited<ReturnType<StaffService['actor']>>, venueId: string) {
    if (actor.venueId && actor.venueId !== venueId) {
      throw new ForbiddenException({
        code: 'VENUE_ACCESS_DENIED',
        message: 'Bạn chỉ quản lý nhân viên ở cơ sở của mình.',
      });
    }
    if (!(await this.venues.findById(venueId))) {
      throw new BadRequestException({ code: 'VENUE_NOT_FOUND', message: 'Cơ sở không tồn tại.' });
    }
  }

  private async getManageable(actor: Awaited<ReturnType<StaffService['actor']>>, id: string) {
    const target = await this.memberships.findInTenant(actor.tenantId, id);
    if (!target || (actor.venueId && target.venueId !== actor.venueId)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Không tìm thấy nhân viên.' });
    }
    if (target.userId === actor.userId) {
      throw new BadRequestException({
        code: 'CANNOT_MANAGE_SELF',
        message: 'Không thể tự đổi vai trò hoặc tự khoá chính mình.',
      });
    }
    this.assertCanManage(actor, target.roleCode);
    return target;
  }

  private toView(
    m: MembershipDoc,
    user: { displayName: string; phone: string; lastLoginAt: Date | null } | null,
    actor: Awaited<ReturnType<StaffService['actor']>>,
  ): StaffView {
    return {
      membershipId: m.id,
      userId: m.userId,
      displayName: user?.displayName ?? '—',
      phone: maskPhone(user?.phone),
      roleCode: m.roleCode,
      venueId: m.venueId,
      status: m.status,
      lastLoginAt: user?.lastLoginAt ?? null,
      isSelf: m.userId === actor.userId,
      canManage:
        m.userId !== actor.userId && canManageRole(actor.permissions, actor.roleCode, m.roleCode),
    };
  }
}

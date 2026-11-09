import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { VN_BANK_BINS } from '../../shared/utils/vietqr';
import { TenantRepository } from './repositories/tenant.repository';
import { VenueRepository } from './repositories/venue.repository';
import { MembershipRepository } from './repositories/membership.repository';
import { SetupWizardDto } from './dto/setup-wizard.dto';
import { CreateVenueDto, UpdateVenueDto } from './dto/venue.dto';
import { newId } from '../../shared/utils/uuid';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { TenantDoc } from './schemas/tenant.schema';
import { VenueDoc } from './schemas/venue.schema';
import { MembershipDoc } from './schemas/membership.schema';
import { canAccessVenue, TenantAccessService } from './tenant-access.service';

@Injectable()
export class TenantService {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly venues: VenueRepository,
    private readonly memberships: MembershipRepository,
    private readonly tenantCtx: TenantContextService,
    private readonly access: TenantAccessService,
  ) {}

  /**
   * Onboard 1-shot: tạo Tenant + Venue đầu + Owner Membership cho user đang login.
   * Không dùng transaction — Mongo standalone không hỗ trợ. Best-effort:
   * nếu venue create fail, vẫn giữ tenant; user có thể tạo venue lại.
   */
  async setupWizard(
    userId: string,
    dto: SetupWizardDto,
  ): Promise<{
    tenant: TenantDoc;
    venue: VenueDoc;
    membership: MembershipDoc;
  }> {
    const existing = await this.tenants.findByOwner(userId);
    if (existing.length > 0) {
      throw new ConflictException({
        code: 'TENANT_ALREADY_EXISTS',
        message: 'Tài khoản này đã có doanh nghiệp. Vui lòng chọn doanh nghiệp để tiếp tục.',
      });
    }

    const tenant = await this.tenants.create({
      name: dto.tenantName,
      slug: await this.tenants.generateUniqueSlug(dto.tenantName),
      taxCode: dto.taxCode ?? null,
      ownerUserId: userId,
    });

    const now = new Date();
    const venueDoc: Partial<VenueDoc> = {
      id: newId(),
      tenantId: tenant.id,
      name: dto.venueName,
      code: dto.venueCode.toUpperCase(),
      businessType: dto.businessType,
      address: { line1: dto.address, city: dto.city, country: 'VN' },
      contact: {},
      timezone: 'Asia/Ho_Chi_Minh',
      currency: 'VND',
      status: 'active',
      settings: {
        serviceChargeRate: 0,
        vatRate: 0.08,
        autoEinvoice: false,
        einvoiceProvider: null,
        bankAccount: null,
      },
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      deletedAt: null,
    };
    const venue = await this.venues.createWithTenant(tenant.id, venueDoc);

    const membership = await this.memberships.create({
      tenantId: tenant.id,
      userId,
      venueId: null,
      roleCode: 'owner',
      status: 'active',
    });

    return { tenant, venue, membership };
  }

  /** Cũ → mới: cơ sở đầu tiên (tạo ở setup wizard) luôn đứng đầu — web chọn nó làm mặc định. */
  async listVenues(): Promise<VenueDoc[]> {
    return this.venues.find({}, { sort: { createdAt: 1 } });
  }

  async createVenue(dto: CreateVenueDto): Promise<VenueDoc> {
    const tenantId = this.tenantCtx.tenantId();
    // Quản lý gắn 1 cơ sở cũng có `venue.manage` nhưng chỉ chủ/quản trị toàn chuỗi mới mở chi nhánh.
    const scope = await this.access.venueScope(this.tenantCtx.userId(), tenantId);
    if (!scope.tenantWide) {
      throw new ForbiddenException({
        code: 'VENUE_ACCESS_DENIED',
        message: 'Chỉ chủ quán hoặc quản trị toàn chuỗi mới tạo được chi nhánh.',
      });
    }
    const dup = await this.venues.findByCode(tenantId, dto.code.toUpperCase());
    if (dup) {
      throw new ConflictException({
        code: 'VENUE_CODE_TAKEN',
        message: 'Mã chi nhánh đã tồn tại.',
      });
    }
    return this.venues.create({
      name: dto.name,
      code: dto.code.toUpperCase(),
      businessType: dto.businessType,
      address: { line1: dto.addressLine1, city: dto.city, country: 'VN' },
      contact: { phone: dto.phone },
      timezone: 'Asia/Ho_Chi_Minh',
      currency: 'VND',
      status: 'active',
      settings: {
        serviceChargeRate: 0,
        vatRate: 0.08,
        autoEinvoice: false,
        einvoiceProvider: null,
        bankAccount: null,
      },
    } as Partial<VenueDoc>);
  }

  async updateVenue(id: string, dto: UpdateVenueDto): Promise<VenueDoc> {
    // Quản lý gắn cơ sở chỉ sửa được cơ sở của mình.
    const scope = await this.access.venueScope(this.tenantCtx.userId(), this.tenantCtx.tenantId());
    if (!canAccessVenue(scope, id)) {
      throw new ForbiddenException({
        code: 'VENUE_ACCESS_DENIED',
        message: 'Bạn không có quyền truy cập cơ sở này.',
        details: { venueId: id },
      });
    }
    const patch: Record<string, unknown> = { $set: {} };
    const set = patch.$set as Record<string, unknown>;
    if (dto.name !== undefined) set.name = dto.name;
    if (dto.addressLine1 !== undefined) set['address.line1'] = dto.addressLine1;
    if (dto.city !== undefined) set['address.city'] = dto.city;
    if (dto.phone !== undefined) set['contact.phone'] = dto.phone;
    if (dto.logoUrl !== undefined) set.logoUrl = dto.logoUrl || null;
    if (dto.serviceChargeRate !== undefined)
      set['settings.serviceChargeRate'] = dto.serviceChargeRate;
    if (dto.vatRate !== undefined) set['settings.vatRate'] = dto.vatRate;
    if (dto.receiptFooter !== undefined) set['settings.receiptFooter'] = dto.receiptFooter || null;
    if (dto.bankAccount !== undefined) {
      set['settings.bankAccount'] = dto.bankAccount
        ? {
            bankBin: dto.bankAccount.bankBin,
            bankName: dto.bankAccount.bankName ?? VN_BANK_BINS[dto.bankAccount.bankBin] ?? null,
            accountNumber: dto.bankAccount.accountNumber,
            accountName: dto.bankAccount.accountName,
          }
        : null;
    }
    return this.venues.updateById(id, patch);
  }

  async getVenue(id: string): Promise<VenueDoc> {
    return this.venues.findByIdOrFail(id);
  }

  async listMyMemberships(userId: string): Promise<MembershipDoc[]> {
    return this.memberships.findActiveByUser(userId);
  }

  async getMembership(userId: string, tenantId: string): Promise<MembershipDoc | null> {
    return this.memberships.findByUserAndTenant(userId, tenantId);
  }
}

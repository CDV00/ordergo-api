import { ConflictException, Injectable } from '@nestjs/common';
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

@Injectable()
export class TenantService {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly venues: VenueRepository,
    private readonly memberships: MembershipRepository,
    private readonly tenantCtx: TenantContextService,
  ) {}

  /**
   * Onboard 1-shot: tạo Tenant + Venue đầu + Owner Membership cho user đang login.
   * Không dùng transaction — Mongo standalone không hỗ trợ. Best-effort:
   * nếu venue create fail, vẫn giữ tenant; user có thể tạo venue lại.
   */
  async setupWizard(userId: string, dto: SetupWizardDto): Promise<{
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

  async listVenues(): Promise<VenueDoc[]> {
    return this.venues.find({}, { sort: { createdAt: -1 } });
  }

  async createVenue(dto: CreateVenueDto): Promise<VenueDoc> {
    const tenantId = this.tenantCtx.tenantId();
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
      status: 'active',
    } as Partial<VenueDoc>);
  }

  async updateVenue(id: string, dto: UpdateVenueDto): Promise<VenueDoc> {
    const patch: Record<string, unknown> = { $set: {} };
    const set = patch.$set as Record<string, unknown>;
    if (dto.name !== undefined) set.name = dto.name;
    if (dto.addressLine1 !== undefined) set['address.line1'] = dto.addressLine1;
    if (dto.city !== undefined) set['address.city'] = dto.city;
    if (dto.phone !== undefined) set['contact.phone'] = dto.phone;
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

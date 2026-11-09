import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CustomerDoc } from '../schemas/customer.schema';
import { TenantContextService } from '../../../common/context/tenant-context.service';
import { BaseTenantRepository } from '../../../shared/base/base.repository';

/**
 * Truy cập khách hàng cho màn quản lý (nhân viên đã đăng nhập) — mọi query tự gắn `tenantId`
 * từ context + `deletedAt: null`, nên id khách của tenant khác → không tìm thấy (404).
 * `CustomerRepository` (cũ) phục vụ luồng QR công khai với tenantId truyền tay — giữ nguyên.
 */
@Injectable()
export class CustomerTenantRepository extends BaseTenantRepository<CustomerDoc> {
  constructor(
    @InjectModel(CustomerDoc.name) model: Model<CustomerDoc>,
    tenantCtx: TenantContextService,
  ) {
    super(model, tenantCtx);
  }
}

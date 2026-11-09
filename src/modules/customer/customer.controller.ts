import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CustomerService } from './customer.service';
import { ListCustomersQuery, UpdateCustomerDto } from './dto/customer.dto';

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomerController {
  constructor(private readonly service: CustomerService) {}

  /** Danh sách khách (PII đã che). `order.pay`: thu ngân; quản lý qua `order.manage`; chủ quán `*`. */
  @Get()
  @RequirePermissions('order.pay')
  list(@Query() q: ListCustomersQuery) {
    return this.service.list(q);
  }

  @Get(':id')
  @RequirePermissions('order.pay')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  /** Xem thông tin đầy đủ — chỉ chủ quán/tenant admin; ghi audit, tối đa 30 lần/giờ. */
  @Post(':id/reveal')
  @HttpCode(200)
  @RequirePermissions('customer.reveal')
  reveal(@Param('id') id: string) {
    return this.service.reveal(id);
  }

  @Patch(':id')
  @RequirePermissions('order.manage')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.service.update(id, dto);
  }

  /** Xoá dữ liệu cá nhân (ẩn danh hoá) — chỉ chủ quán. */
  @Post(':id/anonymize')
  @HttpCode(200)
  @RequirePermissions('customer.manage')
  anonymize(@Param('id') id: string) {
    return this.service.anonymize(id);
  }
}

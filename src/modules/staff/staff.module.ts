import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { IdentityModule } from '../identity/identity.module';
import { TenantModule } from '../tenant/tenant.module';
import { InviteStaffDto, UpdateStaffDto } from './staff.dto';
import { StaffService } from './staff.service';

/** Quản lý nhân viên: liệt kê, mời, đổi vai trò/cơ sở, khoá/mở khoá. */
@ApiTags('Staff')
@ApiBearerAuth()
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermissions('staff.invite')
  list() {
    return this.staff.list();
  }

  @Post('invite')
  @RequirePermissions('staff.invite')
  invite(@Body() dto: InviteStaffDto) {
    return this.staff.invite(dto);
  }

  @Patch(':membershipId')
  @RequirePermissions('staff.invite')
  update(@Param('membershipId') id: string, @Body() dto: UpdateStaffDto) {
    return this.staff.update(id, dto);
  }

  @Post(':membershipId/revoke')
  @RequirePermissions('staff.invite')
  revoke(@Param('membershipId') id: string) {
    return this.staff.setStatus(id, 'revoked');
  }

  @Post(':membershipId/restore')
  @RequirePermissions('staff.invite')
  restore(@Param('membershipId') id: string) {
    return this.staff.setStatus(id, 'active');
  }
}

@Module({
  imports: [IdentityModule, TenantModule],
  providers: [StaffService],
  controllers: [StaffController],
})
export class StaffModule {}

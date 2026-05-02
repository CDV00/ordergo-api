import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TenantService } from './tenant.service';
import { SetupWizardDto } from './dto/setup-wizard.dto';
import { CreateVenueDto, UpdateVenueDto } from './dto/venue.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('Tenant')
@ApiBearerAuth()
@Controller()
export class TenantController {
  constructor(private readonly service: TenantService) {}

  @Post('setup-wizard')
  async setup(@CurrentUser() user: CurrentUserPayload, @Body() dto: SetupWizardDto) {
    return this.service.setupWizard(user.userId, dto);
  }

  @Get('me/memberships')
  async myMemberships(@CurrentUser() user: CurrentUserPayload) {
    return this.service.listMyMemberships(user.userId);
  }

  @Get('venues')
  async listVenues() {
    return this.service.listVenues();
  }

  @Get('venues/:id')
  async getVenue(@Param('id') id: string) {
    return this.service.getVenue(id);
  }

  @Post('venues')
  @RequirePermissions('venue.manage')
  async createVenue(@Body() dto: CreateVenueDto) {
    return this.service.createVenue(dto);
  }

  @Patch('venues/:id')
  @RequirePermissions('venue.manage')
  async updateVenue(@Param('id') id: string, @Body() dto: UpdateVenueDto) {
    return this.service.updateVenue(id, dto);
  }
}

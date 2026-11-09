import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TenantDoc, TenantSchema } from './schemas/tenant.schema';
import { VenueDoc, VenueSchema } from './schemas/venue.schema';
import { MembershipDoc, MembershipSchema } from './schemas/membership.schema';
import { TenantRepository } from './repositories/tenant.repository';
import { VenueRepository } from './repositories/venue.repository';
import { MembershipRepository } from './repositories/membership.repository';
import { TenantService } from './tenant.service';
import { TenantController } from './tenant.controller';
import { TenantAccessService } from './tenant-access.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TenantDoc.name, schema: TenantSchema },
      { name: VenueDoc.name, schema: VenueSchema },
      { name: MembershipDoc.name, schema: MembershipSchema },
    ]),
  ],
  providers: [
    TenantRepository,
    VenueRepository,
    MembershipRepository,
    TenantService,
    TenantAccessService,
  ],
  controllers: [TenantController],
  exports: [
    TenantService,
    MembershipRepository,
    VenueRepository,
    TenantRepository,
    TenantAccessService,
  ],
})
export class TenantModule {}

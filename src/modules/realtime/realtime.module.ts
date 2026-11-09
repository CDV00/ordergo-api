import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TenantModule } from '../tenant/tenant.module';
import { TableSessionModule } from '../table-session/table-session.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeWatcher } from './realtime.watcher';

@Module({
  imports: [JwtModule.register({}), TenantModule, TableSessionModule],
  providers: [RealtimeGateway, RealtimeWatcher],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}

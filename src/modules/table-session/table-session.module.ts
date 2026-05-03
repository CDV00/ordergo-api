import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TableSessionDoc, TableSessionSchema } from './schemas/table-session.schema';
import { TableSessionRepository } from './repositories/table-session.repository';
import { TableSessionService } from './table-session.service';
import { TableSessionWorker } from './table-session.worker';
import { TableModule } from '../table/table.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: TableSessionDoc.name, schema: TableSessionSchema }]),
    TableModule,
  ],
  providers: [TableSessionRepository, TableSessionService, TableSessionWorker],
  exports: [TableSessionRepository, TableSessionService],
})
export class TableSessionModule {}

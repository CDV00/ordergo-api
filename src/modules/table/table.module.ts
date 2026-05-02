import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TableDoc, TableSchema } from './schemas/table.schema';
import { TableRepository } from './repositories/table.repository';
import { TableService } from './table.service';
import { TableController } from './table.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: TableDoc.name, schema: TableSchema }]),
  ],
  providers: [TableRepository, TableService],
  controllers: [TableController],
  exports: [TableRepository, TableService],
})
export class TableModule {}

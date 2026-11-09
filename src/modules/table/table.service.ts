import { Injectable } from '@nestjs/common';
import { TableRepository } from './repositories/table.repository';
import { ChangeTableStatusDto, CreateTableDto, UpdateTableDto } from './dto/table.dto';
import { TableDoc } from './schemas/table.schema';

@Injectable()
export class TableService {
  constructor(private readonly tables: TableRepository) {}

  async list(venueId?: string): Promise<TableDoc[]> {
    const filter: Record<string, unknown> = {};
    if (venueId) filter.venueId = venueId;
    // Theo thứ tự chủ quán tạo (khu + bàn) — sắp theo tên khu sẽ đưa "Lầu 1" lên trước "Tầng trệt"
    return this.tables.find(filter, { sort: { createdAt: 1, name: 1 } });
  }

  async create(dto: CreateTableDto): Promise<TableDoc> {
    return this.tables.create({
      venueId: dto.venueId,
      section: dto.section ?? 'Sảnh',
      name: dto.name,
      capacity: dto.capacity ?? 4,
      status: 'available',
    } as Partial<TableDoc>);
  }

  async update(id: string, dto: UpdateTableDto): Promise<TableDoc> {
    const set: Record<string, unknown> = {};
    if (dto.section !== undefined) set.section = dto.section;
    if (dto.name !== undefined) set.name = dto.name;
    if (dto.capacity !== undefined) set.capacity = dto.capacity;
    return this.tables.updateById(id, { $set: set });
  }

  async changeStatus(id: string, dto: ChangeTableStatusDto): Promise<TableDoc> {
    const set: Record<string, unknown> = { status: dto.status };
    if (dto.status === 'occupied') set.occupiedSince = new Date();
    if (dto.status === 'available') {
      set.occupiedSince = null;
      set.currentOrderId = null;
    }
    return this.tables.updateById(id, { $set: set });
  }

  async delete(id: string): Promise<void> {
    await this.tables.softDelete(id);
  }
}

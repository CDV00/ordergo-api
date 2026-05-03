import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TableSessionRepository } from './repositories/table-session.repository';
import { TableRepository } from '../table/repositories/table.repository';
import { TableSessionDoc } from './schemas/table-session.schema';

interface ScanContext {
  tenantId: string;
  venueId: string;
  tableId: string;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class TableSessionService {
  constructor(
    private readonly sessions: TableSessionRepository,
    private readonly tables: TableRepository,
  ) {}

  async getById(id: string): Promise<TableSessionDoc> {
    const s = await this.sessions.findById(id);
    if (!s) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: 'Phiên không tồn tại hoặc đã đóng.',
      });
    }
    return s;
  }

  async getActiveOrCreate(ctx: ScanContext): Promise<{
    session: TableSessionDoc;
    isNew: boolean;
  }> {
    // Verify table exists & not out_of_order
    const table = await this.tables.findById(ctx.tableId);
    if (!table || table.tenantId !== ctx.tenantId || table.venueId !== ctx.venueId) {
      throw new NotFoundException({
        code: 'TABLE_NOT_FOUND',
        message: 'Không tìm thấy bàn này.',
      });
    }
    if (table.status === 'out_of_order') {
      throw new BadRequestException({
        code: 'TABLE_OUT_OF_ORDER',
        message: 'Bàn này tạm dừng phục vụ.',
      });
    }

    const existing = await this.sessions.findActiveByTable(ctx.tenantId, ctx.venueId, ctx.tableId);
    if (existing) {
      // Touch lastActivity
      await this.sessions.touch(existing.id);
      return { session: existing, isNew: false };
    }

    const session = await this.sessions.create({
      tenantId: ctx.tenantId,
      venueId: ctx.venueId,
      tableId: ctx.tableId,
      tableName: table.name,
      openedBy: 'qr_scan',
      metadata: {
        firstScanIp: ctx.ip,
        firstScanUserAgent: ctx.userAgent,
      },
    });
    return { session, isNew: true };
  }

  async addCustomer(sessionId: string, customerId: string): Promise<void> {
    await this.sessions.addCustomer(sessionId, customerId);
  }

  async recordOrder(sessionId: string, orderId: string, orderTotal: number): Promise<void> {
    await this.sessions.recordOrder(sessionId, orderId, orderTotal);
  }
}

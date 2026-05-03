import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TableSessionDoc } from './schemas/table-session.schema';

/**
 * Worker tự đóng session quá hạn.
 *
 * Chạy mỗi 5 phút:
 *   - Tìm session status='open' có expiresAt < now
 *   - Đóng (status='closed', closedAt=now)
 *   - Log warning nếu có order chưa thu (orderCount > 0 và paidAmount < totalAmount)
 *
 * Lưu ý production: nếu chạy nhiều instance, cần distributed lock (Redis SET NX)
 * để tránh 2 worker cùng đóng session. Hiện tại single-instance OK.
 */
@Injectable()
export class TableSessionWorker {
  private readonly logger = new Logger('TableSessionWorker');

  constructor(
    @InjectModel(TableSessionDoc.name)
    private readonly model: Model<TableSessionDoc>,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'session-ttl-cleanup' })
  async closeExpiredSessions(): Promise<void> {
    const now = new Date();
    const expired = await this.model
      .find({
        status: 'open',
        expiresAt: { $lt: now },
      })
      .lean<TableSessionDoc[]>()
      .limit(100)
      .exec();

    if (expired.length === 0) return;

    this.logger.log(`Closing ${expired.length} expired session(s)`);

    for (const s of expired) {
      const unpaidAmount = s.totalAmount.amount - s.paidAmount.amount;
      if (s.orderCount > 0 && unpaidAmount > 0) {
        this.logger.warn(
          `Session ${s.id} (table ${s.tableName}, tenant ${s.tenantId}) closed with UNPAID ${unpaidAmount}đ across ${s.orderCount} orders — needs staff review`,
        );
      }
      await this.model
        .updateOne(
          { id: s.id, status: 'open' },
          { $set: { status: 'closed', closedAt: now, updatedAt: now } },
        )
        .exec();
    }
  }

  /**
   * Worker phụ — phát hiện idle (30 phút không order) cho session đang open.
   * Chỉ log để monitor; sau này có thể push noti staff dashboard.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'session-idle-watch' })
  async watchIdleSessions(): Promise<void> {
    const idleThreshold = new Date(Date.now() - 30 * 60 * 1000);
    const idle = await this.model
      .countDocuments({
        status: 'open',
        lastActivityAt: { $lt: idleThreshold },
      })
      .exec();
    if (idle > 0) {
      this.logger.log(`${idle} session(s) idle > 30 phút — staff cần kiểm tra`);
    }
  }
}

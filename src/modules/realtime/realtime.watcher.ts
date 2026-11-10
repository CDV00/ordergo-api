import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { RealtimeGateway } from './realtime.gateway';
import {
  OrderChangedPayload,
  PaymentChangedPayload,
  RealtimeEvent,
  TableChangedPayload,
} from './realtime.rooms';

/** Kiểu tối giản — mongoose đóng gói bản mongodb riêng nên không import type từ 'mongodb'. */
interface ChangeEvent<T> {
  operationType: string;
  fullDocument?: T | null;
}
interface Stream<T> {
  on(event: 'change', cb: (change: ChangeEvent<T>) => void): unknown;
  on(event: 'error', cb: (err: Error & { code?: number }) => void): unknown;
  on(event: 'close', cb: () => void): unknown;
  close(): Promise<void>;
}

/** Field của document thô cần đọc (change stream trả bản ghi Mongo, chưa qua Mongoose). */
interface RawOrder {
  id: string;
  tenantId?: string;
  venueId?: string;
  tableId?: string | null;
  tableName?: string | null;
  orderNumber: string;
  status: string;
  source: string;
  lines?: Array<{ sentToKitchenAt?: Date | null; kitchenStatus?: string }>;
  paymentRequest?: { method: string; amount: number; requestedAt: Date } | null;
}
interface RawTable {
  id: string;
  tenantId?: string;
  venueId?: string;
  status: string;
}
interface RawPayment {
  id: string;
  tenantId?: string;
  venueId?: string;
  orderId: string;
  method: string;
  amount?: { amount?: number };
}

/** Mã lỗi Mongo khi change stream không khả dụng (standalone, không phải replica set). */
const NOT_REPLICA_SET_CODES = new Set([40573, 40324]);
const RETRY_MS = 1_000;

/**
 * Theo dõi orders / tables / payments bằng MongoDB change streams và đẩy sự kiện qua Socket.IO.
 *
 * Vì sao change stream thay vì emit trong service: bắt được mọi đường ghi (POS, khách QR, cron,
 * script) mà không phải nhớ gọi emit ở từng chỗ. Chạy nhiều instance API vẫn đúng: mỗi instance
 * đều thấy mọi thay đổi và chỉ phát cho socket nó đang giữ — không cần Redis adapter, không trùng.
 *
 * Cần replica set (docker-compose đã chạy rs0). Standalone → log cảnh báo, client tự poll dự phòng.
 * Tắt hẳn bằng REALTIME_DISABLED=1.
 */
@Injectable()
export class RealtimeWatcher implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('RealtimeWatcher');
  private readonly streams: Array<Stream<unknown>> = [];
  private stopped = false;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly gateway: RealtimeGateway,
  ) {}

  onModuleInit(): void {
    if (process.env.REALTIME_DISABLED === '1') return;
    this.watch<RawOrder>('orders', (o, op) => this.onOrder(o, op));
    this.watch<RawTable>('tables', (t) => this.onTable(t));
    this.watch<RawPayment>('payments', (p) => this.onPayment(p));
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    await Promise.all(this.streams.map((s) => s.close().catch(() => undefined)));
  }

  private watch<T>(collection: string, handler: (doc: T, op: string) => void): void {
    let disabled = false;
    const open = () => {
      if (this.stopped || disabled) return;
      const stream = this.connection
        .collection(collection)
        .watch([{ $match: { operationType: { $in: ['insert', 'update', 'replace'] } } }], {
          fullDocument: 'updateLookup',
        }) as unknown as Stream<T>;
      this.streams.push(stream as Stream<unknown>);
      stream.on('change', (change) => {
        if (!change.fullDocument) return;
        try {
          handler(change.fullDocument, change.operationType);
        } catch (err) {
          this.logger.error(`Lỗi xử lý thay đổi ${collection}: ${(err as Error).message}`);
        }
      });
      stream.on('error', (err) => {
        if (err.code !== undefined && NOT_REPLICA_SET_CODES.has(err.code)) {
          disabled = true;
          this.logger.warn(
            `MongoDB không phải replica set — tắt realtime cho "${collection}" (client sẽ poll).`,
          );
        } else if (!this.stopped) {
          this.logger.warn(`Change stream "${collection}" lỗi: ${err.message} — mở lại`);
        }
        void stream.close().catch(() => undefined);
      });
      // Stream đóng vì lỗi mạng, failover, hoặc bị invalidate (drop/rename collection, drop DB)
      // → mở lại. Đóng do tắt app / không phải replica set thì thôi.
      stream.on('close', () => {
        const i = this.streams.indexOf(stream as Stream<unknown>);
        if (i >= 0) this.streams.splice(i, 1);
        if (!this.stopped && !disabled) setTimeout(open, RETRY_MS);
      });
    };
    open();
  }

  private onOrder(o: RawOrder, op: string): void {
    if (!o.tenantId || !o.venueId) return;
    const kitchen = { queued: 0, preparing: 0, ready: 0 };
    for (const l of o.lines ?? []) {
      if (!l.sentToKitchenAt) continue;
      if (l.kitchenStatus === 'queued') kitchen.queued++;
      else if (l.kitchenStatus === 'preparing') kitchen.preparing++;
      else if (l.kitchenStatus === 'ready') kitchen.ready++;
    }
    const payload: OrderChangedPayload = {
      op: op as OrderChangedPayload['op'],
      id: o.id,
      venueId: o.venueId,
      tableId: o.tableId ?? null,
      tableName: o.tableName ?? null,
      orderNumber: o.orderNumber,
      status: o.status,
      source: o.source,
      kitchen,
      paymentRequest: o.paymentRequest
        ? {
            method: o.paymentRequest.method,
            amount: o.paymentRequest.amount,
            requestedAt: new Date(o.paymentRequest.requestedAt).toISOString(),
          }
        : null,
    };
    this.gateway.emitToVenue(o.tenantId, o.venueId, RealtimeEvent.OrderChanged, payload);
    if (o.tableId) {
      // Khách tại bàn chỉ cần biết đơn nào đổi trạng thái — chi tiết lấy qua API phiên
      this.gateway.emitToTable(o.tenantId, o.tableId, RealtimeEvent.OrderChanged, {
        id: o.id,
        status: o.status,
        kitchen,
      });
    }
  }

  private onTable(t: RawTable): void {
    if (!t.tenantId || !t.venueId) return;
    const payload: TableChangedPayload = { id: t.id, venueId: t.venueId, status: t.status };
    this.gateway.emitToVenue(t.tenantId, t.venueId, RealtimeEvent.TableChanged, payload);
  }

  private onPayment(p: RawPayment): void {
    if (!p.tenantId || !p.venueId) return;
    const payload: PaymentChangedPayload = {
      id: p.id,
      venueId: p.venueId,
      orderId: p.orderId,
      amount: p.amount?.amount ?? 0,
      method: p.method,
    };
    this.gateway.emitToVenue(p.tenantId, p.venueId, RealtimeEvent.PaymentChanged, payload);
  }
}

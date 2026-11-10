import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderRepository } from './repositories/order.repository';
import { OrderEventRepository } from './repositories/order-event.repository';
import { MenuItemRepository } from '../catalog/repositories/menu-item.repository';
import { TableRepository } from '../table/repositories/table.repository';
import { VenueRepository } from '../tenant/repositories/venue.repository';
import { CustomerRepository } from '../customer/repositories/customer.repository';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { hasPermission } from '../../common/auth/permissions';
import {
  AddOrderLinesDto,
  ApplyDiscountDto,
  CancelOrderDto,
  CreateOrderDto,
  OrderLineInput,
  RemoveOrderLineDto,
  UpdateOrderLineDto,
} from './dto/order.dto';
import { newId } from '../../shared/utils/uuid';
import { OrderDoc } from './schemas/order.schema';
import { addMoney, multMoney } from '../../shared/utils/money';
import {
  computePricing,
  deriveOrderStatus,
  DiscountSpec,
  OPEN_ORDER_STATUSES,
} from './order-pricing';

type Line = OrderDoc['lines'][number];
type KitchenStatus = Line['kitchenStatus'];

@Injectable()
export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly events: OrderEventRepository,
    private readonly menuItems: MenuItemRepository,
    private readonly tables: TableRepository,
    private readonly venues: VenueRepository,
    private readonly customers: CustomerRepository,
    private readonly tenantCtx: TenantContextService,
  ) {}

  // ─── Đọc ────────────────────────────────────────────────────────────────

  async list(filter: { venueId?: string; status?: string; tableId?: string }): Promise<OrderDoc[]> {
    const f: Record<string, unknown> = {};
    if (filter.venueId) f.venueId = filter.venueId;
    if (filter.tableId) f.tableId = filter.tableId;
    if (filter.status === 'open') f.status = { $in: OPEN_ORDER_STATUSES };
    else if (filter.status) f.status = filter.status;
    return this.orders.find(f, { sort: { createdAt: -1 }, limit: 100 });
  }

  async get(id: string): Promise<OrderDoc> {
    return this.orders.findByIdOrFail(id);
  }

  // ─── Tạo đơn ────────────────────────────────────────────────────────────

  /** `clientId` = Idempotency-Key của POS (truy vết đơn tạo offline), null nếu không có. */
  async createDraft(dto: CreateOrderDto, clientId: string | null = null): Promise<OrderDoc> {
    const tenantId = this.tenantCtx.tenantId();

    if (dto.lines.length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_ORDER',
        message: 'Đơn phải có ít nhất 1 món.',
      });
    }

    // customerId do client gửi → phải là khách của chính quán (chặn gắn khách quán khác để cộng điểm)
    if (dto.customerId && !(await this.customers.existsInTenant(tenantId, dto.customerId))) {
      throw new NotFoundException({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Khách hàng không tồn tại.',
      });
    }

    let tableName: string | null = null;
    if (dto.tableId) {
      const t = await this.tables.findById(dto.tableId);
      if (!t || t.venueId !== dto.venueId) {
        throw new NotFoundException({
          code: 'TABLE_NOT_FOUND',
          message: 'Bàn không tồn tại ở cơ sở này.',
          details: { tableId: dto.tableId },
        });
      }
      tableName = t.name;
    }

    const lines = await this.buildLines(dto.lines, dto.venueId);
    const pricing = computePricing(lines, null, await this.serviceChargeRate(dto.venueId));
    const orderNumber = await this.orders.nextOrderNumber(tenantId, dto.venueId);

    const created = await this.orders.create({
      venueId: dto.venueId,
      orderNumber,
      orderType: dto.orderType,
      businessContext: 'fnb',
      customerId: dto.customerId ?? null,
      customerSnapshot: null,
      tableId: dto.tableId ?? null,
      tableName,
      lines,
      pricing,
      discountInfo: null,
      status: 'draft',
      source: 'pos',
      clientId,
    } as Partial<OrderDoc>);

    await this.events.append({
      tenantId,
      eventType: 'order.created',
      aggregateId: created.id,
      payload: { orderId: created.id, orderNumber: created.orderNumber },
    });

    if (created.tableId) await this.occupyTable(created.tableId, created.id);
    return created;
  }

  // ─── Sửa món ────────────────────────────────────────────────────────────

  /** Thêm món vào đơn đang mở. Món mới chưa gửi bếp cho tới khi gọi send-to-kitchen. */
  async addLines(id: string, dto: AddOrderLinesDto): Promise<OrderDoc> {
    const order = await this.getOpenOrder(id);
    const newLines = await this.buildLines(dto.lines, order.venueId);
    const lines = [...order.lines, ...newLines];
    const updated = await this.saveLines(order, lines);
    await this.events.append({
      tenantId: order.tenantId,
      eventType: 'order.lines_added',
      aggregateId: order.id,
      payload: { orderId: order.id, lineIds: newLines.map((l) => l.id) },
    });
    return updated;
  }

  /** Đổi số lượng / ghi chú — chỉ món chưa gửi bếp. */
  async updateLine(id: string, lineId: string, dto: UpdateOrderLineDto): Promise<OrderDoc> {
    const order = await this.getOpenOrder(id);
    const target = this.findLine(order, lineId);
    if (target.sentToKitchenAt) {
      throw new BadRequestException({
        code: 'LINE_ALREADY_SENT',
        message: 'Món đã gửi bếp — huỷ món rồi thêm lại nếu cần đổi.',
      });
    }
    const lines = order.lines.map((l) => {
      if (l.id !== lineId) return l;
      const quantity = dto.quantity ?? l.quantity;
      const lineSubtotal = multMoney(l.unitPrice, quantity);
      return {
        ...l,
        quantity,
        note: dto.note !== undefined ? dto.note || null : l.note,
        lineSubtotal,
        lineTotal: lineSubtotal,
      };
    });
    return this.saveLines(order, lines);
  }

  /**
   * Bỏ món:
   *  - chưa gửi bếp → xoá hẳn
   *  - đã gửi bếp   → đánh dấu cancelled (giữ lịch sử), cần quyền `order.cancel` (quản lý)
   */
  async removeLine(id: string, lineId: string, dto: RemoveOrderLineDto): Promise<OrderDoc> {
    const order = await this.getOpenOrder(id);
    const target = this.findLine(order, lineId);

    let lines: Line[];
    if (!target.sentToKitchenAt) {
      lines = order.lines.filter((l) => l.id !== lineId);
    } else {
      this.requirePermission('order.cancel', 'Món đã gửi bếp — cần quản lý huỷ món.');
      if (target.kitchenStatus === 'served') {
        throw new BadRequestException({
          code: 'LINE_ALREADY_SERVED',
          message: 'Món đã phục vụ, không huỷ được. Dùng giảm giá nếu cần bù cho khách.',
        });
      }
      lines = order.lines.map((l) =>
        l.id === lineId
          ? { ...l, kitchenStatus: 'cancelled' as const, note: dto.reason ?? l.note }
          : l,
      );
    }

    if (lines.filter((l) => l.kitchenStatus !== 'cancelled').length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_ORDER',
        message: 'Đơn phải còn ít nhất 1 món — huỷ cả đơn nếu khách không dùng nữa.',
      });
    }

    const updated = await this.saveLines(order, lines);
    await this.events.append({
      tenantId: order.tenantId,
      eventType: 'order.line_removed',
      aggregateId: order.id,
      payload: {
        orderId: order.id,
        lineId,
        wasSent: !!target.sentToKitchenAt,
        reason: dto.reason ?? null,
      },
    });
    return updated;
  }

  /** Gửi bếp mọi món chưa gửi (lần đầu hoặc món gọi thêm). */
  async sendToKitchen(id: string): Promise<OrderDoc> {
    const order = await this.getOpenOrder(id);
    const now = new Date();
    let sentCount = 0;
    const lines = order.lines.map((l) => {
      if (l.sentToKitchenAt || l.kitchenStatus === 'cancelled') return l;
      sentCount++;
      return { ...l, sentToKitchenAt: now, kitchenStatus: 'queued' as const };
    });
    if (sentCount === 0) {
      throw new BadRequestException({
        code: 'NOTHING_TO_SEND',
        message: 'Không có món mới để gửi bếp.',
      });
    }
    const status = deriveOrderStatus(lines, order.status);
    const updated = await this.orders.updateById(id, {
      $set: { lines, status, sentAt: order.sentAt ?? now },
    });
    await this.events.append({
      tenantId: order.tenantId,
      eventType: 'order.sent_to_kitchen',
      aggregateId: order.id,
      payload: { orderId: order.id, lineCount: sentCount },
    });
    return updated;
  }

  async setLineKitchenStatus(
    orderId: string,
    lineId: string,
    status: KitchenStatus,
  ): Promise<OrderDoc> {
    const order = await this.orders.findByIdOrFail(orderId);
    if (order.status === 'cancelled' || order.status === 'paid' || order.status === 'refunded') {
      throw new BadRequestException({
        code: 'INVALID_ORDER_STATUS',
        message: 'Không thể đổi trạng thái món của đơn này.',
      });
    }
    const target = this.findLine(order, lineId);
    if (!target.sentToKitchenAt) {
      throw new BadRequestException({
        code: 'LINE_NOT_SENT',
        message: 'Món chưa được gửi bếp.',
      });
    }
    const now = new Date();
    const lines = order.lines.map((l) => {
      if (l.id !== lineId) return l;
      const patch: Partial<Line> = { kitchenStatus: status };
      if (status === 'ready' && !l.readyAt) patch.readyAt = now;
      if (status === 'served' && !l.servedAt) patch.servedAt = now;
      return { ...l, ...patch };
    });

    const set: Record<string, unknown> = {
      lines,
      status: deriveOrderStatus(lines, order.status),
    };
    if (status === 'cancelled') {
      // Bếp báo hết/không làm được → bỏ khỏi tiền
      set.pricing = computePricing(
        lines,
        order.discountInfo ?? null,
        await this.serviceChargeRate(order.venueId),
      );
    }
    const updated = await this.orders.updateById(orderId, { $set: set });
    await this.events.append({
      tenantId: order.tenantId,
      eventType: `order.line_${status}`,
      aggregateId: orderId,
      payload: { orderId, lineId, status },
    });
    return updated;
  }

  // ─── Giảm giá, chuyển bàn, huỷ ──────────────────────────────────────────

  async applyDiscount(id: string, dto: ApplyDiscountDto): Promise<OrderDoc> {
    const order = await this.getOpenOrder(id);
    if (dto.type === 'percent' && dto.value > 100) {
      throw new BadRequestException({
        code: 'INVALID_DISCOUNT',
        message: 'Giảm giá phần trăm tối đa 100%.',
      });
    }
    const discount: DiscountSpec | null =
      dto.value > 0 ? { type: dto.type, value: dto.value, reason: dto.reason ?? null } : null;
    const pricing = computePricing(
      order.lines,
      discount,
      await this.serviceChargeRate(order.venueId),
    );
    const updated = await this.orders.updateById(id, {
      $set: { discountInfo: discount, pricing },
    });
    await this.events.append({
      tenantId: order.tenantId,
      eventType: 'order.discount_applied',
      aggregateId: order.id,
      payload: { orderId: order.id, discount, amount: pricing.discount.amount },
    });
    return updated;
  }

  async moveTable(id: string, tableId: string): Promise<OrderDoc> {
    const order = await this.getOpenOrder(id);
    if (order.tableId === tableId) return order;
    const target = await this.tables.findById(tableId);
    if (!target || target.venueId !== order.venueId) {
      throw new NotFoundException({
        code: 'TABLE_NOT_FOUND',
        message: 'Bàn không tồn tại ở cơ sở này.',
      });
    }
    if (target.status === 'out_of_order') {
      throw new BadRequestException({
        code: 'TABLE_UNAVAILABLE',
        message: `Bàn ${target.name} đang tạm ngưng phục vụ.`,
      });
    }
    const fromTableId = order.tableId;
    const updated = await this.orders.updateById(id, {
      $set: { tableId: target.id, tableName: target.name, orderType: 'dine_in' },
    });
    await this.occupyTable(target.id, order.id);
    if (fromTableId) await this.releaseTableIfIdle(fromTableId, 'available');
    await this.events.append({
      tenantId: order.tenantId,
      eventType: 'order.table_moved',
      aggregateId: order.id,
      payload: { orderId: order.id, fromTableId, toTableId: target.id },
    });
    return updated;
  }

  async cancel(id: string, dto: CancelOrderDto): Promise<OrderDoc> {
    const order = await this.orders.findByIdOrFail(id);
    if (['paid', 'cancelled', 'refunded'].includes(order.status)) {
      throw new BadRequestException({
        code: 'CANNOT_CANCEL',
        message: 'Không thể huỷ đơn ở trạng thái hiện tại.',
      });
    }
    const updated = await this.orders.updateById(id, {
      $set: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: dto.reason ?? null,
        paymentRequest: null,
      },
    });
    await this.events.append({
      tenantId: order.tenantId,
      eventType: 'order.cancelled',
      aggregateId: order.id,
      payload: { orderId: order.id, reason: dto.reason ?? null },
    });
    if (order.tableId) await this.releaseTableIfIdle(order.tableId, 'available');
    return updated;
  }

  /** Gọi bởi PaymentService khi đơn đã thu đủ: bàn chuyển sang "cần dọn" nếu không còn đơn mở. */
  async onOrderPaid(order: OrderDoc): Promise<void> {
    if (order.tableId) await this.releaseTableIfIdle(order.tableId, 'cleaning');
  }

  // ─── Nội bộ ─────────────────────────────────────────────────────────────

  private async getOpenOrder(id: string): Promise<OrderDoc> {
    const order = await this.orders.findByIdOrFail(id);
    if (!OPEN_ORDER_STATUSES.includes(order.status)) {
      throw new BadRequestException({
        code: 'ORDER_CLOSED',
        message: 'Đơn đã thanh toán hoặc đã huỷ, không sửa được.',
      });
    }
    return order;
  }

  private findLine(order: OrderDoc, lineId: string): Line {
    const line = order.lines.find((l) => l.id === lineId);
    if (!line) {
      throw new NotFoundException({
        code: 'LINE_NOT_FOUND',
        message: 'Không tìm thấy món trong đơn.',
        details: { lineId },
      });
    }
    return line;
  }

  private async saveLines(order: OrderDoc, lines: Line[]): Promise<OrderDoc> {
    const pricing = computePricing(
      lines,
      order.discountInfo ?? null,
      await this.serviceChargeRate(order.venueId),
    );
    return this.orders.updateById(order.id, {
      $set: { lines, pricing, status: deriveOrderStatus(lines, order.status) },
    });
  }

  private requirePermission(permission: string, message: string): void {
    const perms = this.tenantCtx.current()?.permissions ?? [];
    if (!hasPermission(perms, permission)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message,
        details: { missing: [permission] },
      });
    }
  }

  private async serviceChargeRate(venueId: string): Promise<number> {
    const venue = await this.venues.findById(venueId);
    return venue?.settings?.serviceChargeRate ?? 0;
  }

  /** Dựng order line từ input + snapshot menu hiện tại. Món chưa gửi bếp (`sentToKitchenAt = null`). */
  private async buildLines(inputs: OrderLineInput[], venueId: string): Promise<Line[]> {
    return Promise.all(
      inputs.map(async (input) => {
        const item = await this.menuItems.findById(input.menuItemId);
        // Món của chi nhánh khác không gọi được; món dùng chung toàn chuỗi (venueId null) thì được.
        if (!item || (item.venueId && item.venueId !== venueId)) {
          throw new NotFoundException({
            code: 'MENU_ITEM_NOT_FOUND',
            message: `Món không tồn tại`,
            details: { menuItemId: input.menuItemId },
          });
        }
        if (!item.isAvailable) {
          throw new BadRequestException({
            code: 'MENU_ITEM_UNAVAILABLE',
            message: `Món "${item.name}" hiện đã hết.`,
          });
        }

        let unitPrice = { ...item.basePrice };
        let variantSnapshot: Line['variantSnapshot'] = null;
        if (input.variantId) {
          const variant = item.variants.find((v) => v.id === input.variantId);
          if (!variant) {
            throw new BadRequestException({
              code: 'VARIANT_NOT_FOUND',
              message: 'Biến thể không tồn tại.',
            });
          }
          unitPrice = addMoney(unitPrice, variant.priceModifier);
          variantSnapshot = { name: variant.name, priceModifier: variant.priceModifier };
        }

        const modifiers: Line['modifiers'] = [];
        for (const optId of input.toppingOptionIds ?? []) {
          for (const group of item.toppingGroups) {
            const opt = group.options.find((o) => o.id === optId);
            if (opt) {
              unitPrice = addMoney(unitPrice, opt.priceModifier);
              modifiers.push({
                groupId: group.id,
                groupName: group.name,
                optionId: opt.id,
                optionName: opt.name,
                priceModifier: opt.priceModifier,
              });
              break;
            }
          }
        }

        const lineSubtotal = multMoney(unitPrice, input.quantity);
        return {
          id: newId(),
          productType: 'menu_item',
          productId: item.id,
          productSnapshot: { name: item.name, sku: item.sku, imageUrl: item.imageUrl },
          variantId: input.variantId ?? null,
          variantSnapshot,
          modifiers,
          quantity: input.quantity,
          unitPrice,
          lineSubtotal,
          discount: { amount: 0, currency: 'VND' },
          lineTotal: lineSubtotal,
          note: input.note ?? null,
          kitchenStatus: 'queued' as const,
          sentToKitchenAt: null,
          readyAt: null,
          servedAt: null,
        };
      }),
    );
  }

  private async occupyTable(tableId: string, orderId: string): Promise<void> {
    const table = await this.tables.findById(tableId);
    if (!table) return;
    if (table.status === 'occupied' && table.currentOrderId) return;
    await this.tables.updateById(tableId, {
      $set: {
        status: 'occupied',
        currentOrderId: orderId,
        occupiedSince: table.status === 'occupied' ? table.occupiedSince : new Date(),
      },
    });
  }

  /** Bàn không còn đơn mở → chuyển sang `next` (cleaning sau khi thu, available sau khi huỷ/chuyển). */
  private async releaseTableIfIdle(tableId: string, next: 'cleaning' | 'available'): Promise<void> {
    const stillOpen = await this.orders.find(
      { tableId, status: { $in: OPEN_ORDER_STATUSES } },
      { limit: 1, sort: { createdAt: -1 } },
    );
    if (stillOpen.length > 0) {
      await this.tables.updateById(tableId, { $set: { currentOrderId: stillOpen[0].id } });
      return;
    }
    const table = await this.tables.findById(tableId);
    if (!table || table.status !== 'occupied') return;
    await this.tables.updateById(tableId, {
      $set: { status: next, currentOrderId: null, occupiedSince: null },
    });
  }
}

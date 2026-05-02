import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderRepository } from './repositories/order.repository';
import { OrderEventRepository } from './repositories/order-event.repository';
import { MenuItemRepository } from '../catalog/repositories/menu-item.repository';
import { TableRepository } from '../table/repositories/table.repository';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AddOrderLineDto, CancelOrderDto, CreateOrderDto } from './dto/order.dto';
import { newId } from '../../shared/utils/uuid';
import { OrderDoc } from './schemas/order.schema';
import { addMoney, multMoney } from '../../shared/utils/money';

@Injectable()
export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly events: OrderEventRepository,
    private readonly menuItems: MenuItemRepository,
    private readonly tables: TableRepository,
    private readonly tenantCtx: TenantContextService,
  ) {}

  async list(filter: { venueId?: string; status?: string }): Promise<OrderDoc[]> {
    const f: Record<string, unknown> = {};
    if (filter.venueId) f.venueId = filter.venueId;
    if (filter.status) f.status = filter.status;
    return this.orders.find(f, { sort: { createdAt: -1 }, limit: 100 });
  }

  async get(id: string): Promise<OrderDoc> {
    return this.orders.findByIdOrFail(id);
  }

  async createDraft(dto: CreateOrderDto): Promise<OrderDoc> {
    const tenantId = this.tenantCtx.tenantId();

    if (dto.lines.length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_ORDER',
        message: 'Đơn phải có ít nhất 1 món.',
      });
    }

    // Build lines với snapshot từ menu_items
    const lines = await Promise.all(
      dto.lines.map(async (input) => {
        const item = await this.menuItems.findById(input.menuItemId);
        if (!item) {
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
        let variantSnapshot: { name: string; priceModifier: typeof item.basePrice } | null = null;
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

        const modifiers: OrderDoc['lines'][number]['modifiers'] = [];
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
          productSnapshot: {
            name: item.name,
            sku: item.sku,
            imageUrl: item.imageUrl,
          },
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

    const subtotal = lines.reduce(
      (acc, l) => addMoney(acc, l.lineTotal),
      { amount: 0, currency: 'VND' },
    );

    let tableName: string | null = null;
    if (dto.tableId) {
      const t = await this.tables.findById(dto.tableId);
      if (t) tableName = t.name;
    }

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
      pricing: {
        subtotal,
        discount: { amount: 0, currency: 'VND' },
        serviceCharge: { amount: 0, currency: 'VND' },
        tax: { amount: 0, currency: 'VND' },
        total: subtotal,
      },
      status: 'draft',
      source: 'pos',
    } as Partial<OrderDoc>);

    await this.events.append({
      tenantId,
      eventType: 'order.created',
      aggregateId: created.id,
      payload: { orderId: created.id, orderNumber: created.orderNumber },
    });

    return created;
  }

  async sendToKitchen(id: string): Promise<OrderDoc> {
    const order = await this.orders.findByIdOrFail(id);
    if (order.status !== 'draft') {
      throw new BadRequestException({
        code: 'INVALID_ORDER_STATUS',
        message: 'Chỉ đơn nháp mới gửi xuống bếp được.',
      });
    }
    const updatedLines = order.lines.map((l) => ({
      ...l,
      sentToKitchenAt: new Date(),
      kitchenStatus: 'queued' as const,
    }));
    const updated = await this.orders.updateById(id, {
      $set: { status: 'sent', sentAt: new Date(), lines: updatedLines },
    });
    await this.events.append({
      tenantId: order.tenantId,
      eventType: 'order.sent_to_kitchen',
      aggregateId: order.id,
      payload: { orderId: order.id },
    });
    return updated;
  }

  async setLineKitchenStatus(
    orderId: string,
    lineId: string,
    status: 'queued' | 'preparing' | 'ready' | 'served' | 'cancelled',
  ): Promise<OrderDoc> {
    const order = await this.orders.findByIdOrFail(orderId);
    if (order.status === 'cancelled' || order.status === 'paid') {
      throw new BadRequestException({
        code: 'INVALID_ORDER_STATUS',
        message: 'Không thể đổi trạng thái món của đơn này.',
      });
    }
    const now = new Date();
    const newLines = order.lines.map((l) => {
      if (l.id !== lineId) return l;
      const patch: Partial<typeof l> = { kitchenStatus: status };
      if (status === 'ready' && !l.readyAt) patch.readyAt = now;
      if (status === 'served' && !l.servedAt) patch.servedAt = now;
      return { ...l, ...patch };
    });

    // Tính status order tổng hợp từ lines
    const allReady = newLines.every(
      (l) => l.kitchenStatus === 'ready' || l.kitchenStatus === 'served' || l.kitchenStatus === 'cancelled',
    );
    const anyPreparing = newLines.some((l) => l.kitchenStatus === 'preparing');
    const allServed = newLines.every(
      (l) => l.kitchenStatus === 'served' || l.kitchenStatus === 'cancelled',
    );

    const set: Record<string, unknown> = { lines: newLines };
    if (allServed && order.status !== 'served') set.status = 'served';
    else if (allReady && order.status !== 'ready' && order.status !== 'served') set.status = 'ready';
    else if (anyPreparing && order.status === 'sent') set.status = 'in_progress';

    const updated = await this.orders.updateById(orderId, { $set: set });
    await this.events.append({
      tenantId: order.tenantId,
      eventType: `order.line_${status}`,
      aggregateId: orderId,
      payload: { orderId, lineId, status },
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
      },
    });
    await this.events.append({
      tenantId: order.tenantId,
      eventType: 'order.cancelled',
      aggregateId: order.id,
      payload: { orderId: order.id, reason: dto.reason ?? null },
    });
    return updated;
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantRepository } from '../tenant/repositories/tenant.repository';
import { VenueRepository } from '../tenant/repositories/venue.repository';
import { TableRepository } from '../table/repositories/table.repository';
import { TableSessionService } from '../table-session/table-session.service';
import { CustomerRepository } from '../customer/repositories/customer.repository';
import { MenuCategoryRepository } from '../catalog/repositories/menu-category.repository';
import { MenuItemRepository } from '../catalog/repositories/menu-item.repository';
import { OrderRepository } from '../order/repositories/order.repository';
import { OrderEventRepository } from '../order/repositories/order-event.repository';
import { OtpService } from '../otp/otp.service';
import { UserRepository } from '../identity/repositories/user.repository';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { newId } from '../../shared/utils/uuid';
import { buildVietQrPayload } from '../../shared/utils/vietqr';
import { addMoney, multMoney } from '../../shared/utils/money';
import { PublicCreateOrderDto } from './dto/public-order.dto';
import { TableSessionDoc } from '../table-session/schemas/table-session.schema';
import { CustomerDoc } from '../customer/schemas/customer.schema';
import { OrderDoc } from '../order/schemas/order.schema';
import { MenuItemDoc } from '../catalog/schemas/menu-item.schema';
import { MenuCategoryDoc } from '../catalog/schemas/menu-category.schema';

interface ScanResult {
  session: TableSessionDoc;
  customer: CustomerDoc;
  isNewSession: boolean;
  isNewCustomer: boolean;
}

function normalizePhone(p: string): string {
  let s = p.trim();
  if (s.startsWith('0')) s = '+84' + s.substring(1);
  if (!s.startsWith('+')) s = '+' + s;
  return s;
}

@Injectable()
export class PublicApiService {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly venues: VenueRepository,
    private readonly tables: TableRepository,
    private readonly sessions: TableSessionService,
    private readonly customers: CustomerRepository,
    private readonly menuCategories: MenuCategoryRepository,
    private readonly menuItems: MenuItemRepository,
    private readonly orders: OrderRepository,
    private readonly orderEvents: OrderEventRepository,
    private readonly otp: OtpService,
    private readonly users: UserRepository,
    private readonly tenantCtx: TenantContextService,
  ) {}

  /**
   * QR scan flow.
   * - Resolve tenant by slug
   * - Resolve venue + table
   * - Get/create session
   * - Get/create anonymous customer (qua cookieAnchor)
   */
  async scan(params: {
    tenantSlug: string;
    tableId: string;
    cookieSessionId?: string | null;
    cookieAnchor?: string | null;
    ip?: string;
    userAgent?: string;
  }): Promise<ScanResult> {
    const tenant = await this.tenants.findBySlug(params.tenantSlug);
    if (!tenant) {
      throw new NotFoundException({
        code: 'TENANT_NOT_FOUND',
        message: 'Quán không tồn tại hoặc đã đóng cửa.',
      });
    }
    if (tenant.status !== 'active') {
      throw new BadRequestException({
        code: 'TENANT_INACTIVE',
        message: 'Quán hiện không nhận đơn online.',
      });
    }

    // tenantContext cho repository tenant-scoped (Table)
    return this.tenantCtx.run(
      {
        tenantId: tenant.id,
        userId: null,
        venueId: null,
        permissions: [],
      },
      async () => {
        const table = await this.tables.findById(params.tableId);
        if (!table) {
          throw new NotFoundException({
            code: 'TABLE_NOT_FOUND',
            message: 'Bàn không tồn tại.',
          });
        }

        // Resolve session
        const { session, isNew: isNewSession } = await this.sessions.getActiveOrCreate({
          tenantId: tenant.id,
          venueId: table.venueId,
          tableId: table.id,
          ip: params.ip,
          userAgent: params.userAgent,
        });

        // Resolve customer
        let customer: CustomerDoc | null = null;
        let isNewCustomer = false;

        if (params.cookieAnchor) {
          customer = await this.customers.findByCookieAnchor(tenant.id, params.cookieAnchor);
        }

        if (!customer) {
          const anchor = params.cookieAnchor || newId();
          customer = await this.customers.createAnonymous({
            tenantId: tenant.id,
            cookieAnchor: anchor,
          });
          isNewCustomer = true;
        }

        await this.sessions.addCustomer(session.id, customer.id);

        return { session, customer, isNewSession, isNewCustomer };
      },
    );
  }

  /** Lấy menu của venue thuộc session — cho khách browse */
  async getMenu(session: TableSessionDoc): Promise<{
    venue: { id: string; name: string; currency: string };
    categories: MenuCategoryDoc[];
    items: MenuItemDoc[];
  }> {
    return this.tenantCtx.run(
      {
        tenantId: session.tenantId,
        userId: null,
        venueId: session.venueId,
        permissions: [],
      },
      async () => {
        const venue = await this.venues.findByIdOrFail(session.venueId);
        const [categories, items] = await Promise.all([
          // Menu của cơ sở có bàn này + menu dùng chung toàn chuỗi (venueId=null)
          this.menuCategories.find(
            { isActive: true, venueId: { $in: [session.venueId, null] } },
            { sort: { displayOrder: 1, createdAt: 1 } },
          ),
          this.menuItems.find(
            { venueId: { $in: [session.venueId, null] } },
            { sort: { displayOrder: 1, createdAt: 1 } },
          ),
        ]);
        return {
          venue: { id: venue.id, name: venue.name, currency: venue.currency },
          categories,
          items,
        };
      },
    );
  }

  /** Tạo order từ public — không cần JWT staff */
  async createOrder(
    session: TableSessionDoc,
    customerId: string | null,
    dto: PublicCreateOrderDto,
  ): Promise<OrderDoc> {
    if (dto.lines.length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_ORDER',
        message: 'Đơn phải có ít nhất 1 món.',
      });
    }

    return this.tenantCtx.run(
      {
        tenantId: session.tenantId,
        userId: null,
        venueId: session.venueId,
        permissions: [],
      },
      async () => {
        // Build snapshot lines
        const lines = await Promise.all(
          dto.lines.map(async (input) => {
            const item = await this.menuItems.findById(input.menuItemId);
            // Món của chi nhánh khác coi như không có ở cơ sở này
            if (!item || (item.venueId !== null && item.venueId !== session.venueId)) {
              throw new NotFoundException({
                code: 'MENU_ITEM_NOT_FOUND',
                message: 'Một món trong giỏ không còn nữa.',
                details: { menuItemId: input.menuItemId },
              });
            }
            if (!item.isAvailable) {
              throw new BadRequestException({
                code: 'MENU_ITEM_UNAVAILABLE',
                message: `Món "${item.name}" đã hết.`,
              });
            }

            let unitPrice = { ...item.basePrice };
            let variantSnapshot: { name: string; priceModifier: typeof item.basePrice } | null =
              null;
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

        const subtotal = lines.reduce((acc, l) => addMoney(acc, l.lineTotal), {
          amount: 0,
          currency: 'VND',
        });

        const orderNumber = await this.orders.nextOrderNumber(session.tenantId, session.venueId);

        // Customer snapshot từ guestName nếu có (anonymous), hoặc từ Customer record nếu verified
        let customerSnapshot: { name: string; phone: string } | null = null;
        if (dto.guestName) {
          customerSnapshot = { name: dto.guestName, phone: '' };
        } else if (customerId) {
          const c = await this.customers.findById(customerId);
          if (c?.name && c?.phone) {
            customerSnapshot = { name: c.name, phone: c.phone };
          }
        }

        // Auto send-to-kitchen ngay cho QR order — staff confirm sau ở POS
        const now = new Date();
        const sentLines = lines.map((l) => ({ ...l, sentToKitchenAt: now }));

        const created = await this.orders.create({
          venueId: session.venueId,
          orderNumber,
          orderType: 'dine_in',
          businessContext: 'fnb',
          customerId,
          customerSnapshot,
          tableId: session.tableId,
          tableName: session.tableName,
          lines: sentLines,
          pricing: {
            subtotal,
            discount: { amount: 0, currency: 'VND' },
            serviceCharge: { amount: 0, currency: 'VND' },
            tax: { amount: 0, currency: 'VND' },
            total: subtotal,
          },
          status: 'sent',
          sentAt: now,
          source: 'qr_menu',
        } as Partial<OrderDoc>);

        await this.orderEvents.append({
          tenantId: session.tenantId,
          eventType: 'order.created',
          aggregateId: created.id,
          payload: {
            orderId: created.id,
            orderNumber: created.orderNumber,
            sessionId: session.id,
            source: 'qr_menu',
          },
        });
        await this.orderEvents.append({
          tenantId: session.tenantId,
          eventType: 'order.sent_to_kitchen',
          aggregateId: created.id,
          payload: { orderId: created.id, sessionId: session.id },
        });

        // Cập nhật session + customer stats
        await this.sessions.recordOrder(session.id, created.id, created.pricing.total.amount);
        if (customerId) {
          await this.customers.recordOrder(customerId, created.pricing.total.amount);
        }

        return created;
      },
    );
  }

  /** Customer claim flow — request OTP */
  async requestClaimOtp(phone: string, ip?: string) {
    return this.otp.request({ phone, purpose: 'customer_claim', ip });
  }

  /**
   * Verify OTP + claim anonymous customer.
   * - Verify OTP
   * - Find/create User toàn cục với phone
   * - Upgrade Customer (anonymous → verified) hoặc merge với existing tenant customer
   */
  async verifyClaimOtp(params: {
    sessionId: string;
    customerId: string | null;
    phone: string;
    code: string;
    name?: string;
  }): Promise<{ customerId: string; userId: string; merged: boolean; name: string | null }> {
    if (!params.customerId) {
      throw new BadRequestException({
        code: 'NO_ANONYMOUS_CUSTOMER',
        message: 'Vui lòng quét lại QR.',
      });
    }
    const anonymous = await this.customers.findById(params.customerId);
    if (!anonymous) {
      throw new BadRequestException({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Vui lòng quét lại QR.',
      });
    }

    // Verify OTP (consume)
    await this.otp.verify({
      phone: params.phone,
      code: params.code,
      purpose: 'customer_claim',
    });

    // Normalize phone (cùng logic OTP service)
    const normalizedPhone = normalizePhone(params.phone);

    // Find/create global User
    let user = await this.users.findByPhone(normalizedPhone);
    if (!user) {
      user = await this.users.createPasswordless({
        phone: normalizedPhone,
        displayName: params.name ?? `Khách ${normalizedPhone.slice(-4)}`,
      });
    }

    // Claim customer trong tenant
    const result = await this.customers.claimWithPhone({
      anonymousId: anonymous.id,
      tenantId: anonymous.tenantId,
      phone: normalizedPhone,
      userId: user.id,
      name: params.name,
    });

    return {
      customerId: result.customerId,
      userId: user.id,
      merged: result.merged,
      name: params.name ?? user.displayName,
    };
  }

  /** Lấy thông tin customer cho /me — public version */
  async getCustomerSelf(customerId: string): Promise<CustomerDoc | null> {
    return this.customers.findById(customerId);
  }

  /**
   * Sinh VietQR cho khách self-pay 1 đơn cụ thể.
   * Yêu cầu venue đã cấu hình bank account trong settings.
   */
  /**
   * Khách báo thanh toán cho đơn của bàn mình. Không ghi nhận tiền — chỉ đặt `order.paymentRequest`
   * để nhân viên thấy và xác nhận. Gọi lại thì cập nhật phương thức / thời điểm.
   */
  async requestPayment(
    session: TableSessionDoc,
    orderId: string,
    method: 'vietqr' | 'cash' | 'card',
  ): Promise<{ orderId: string; method: string; amount: number; requestedAt: Date }> {
    return this.tenantCtx.run(
      {
        tenantId: session.tenantId,
        userId: null,
        venueId: session.venueId,
        permissions: [],
      },
      async () => {
        const order = await this.orders.findByIdOrFail(orderId);
        if (order.venueId !== session.venueId || !session.orderIds.includes(orderId)) {
          throw new BadRequestException({
            code: 'ORDER_NOT_IN_SESSION',
            message: 'Đơn này không thuộc bàn của bạn.',
          });
        }
        if (['paid', 'cancelled', 'refunded'].includes(order.status)) {
          throw new BadRequestException({
            code: 'ORDER_NOT_PAYABLE',
            message: 'Đơn đã thanh toán hoặc đã huỷ.',
          });
        }
        const requestedAt = new Date();
        const amount = order.pricing.total.amount;
        await this.orders.updateById(orderId, {
          $set: { paymentRequest: { method, amount, requestedAt } },
        });
        return { orderId, method, amount, requestedAt };
      },
    );
  }

  async generatePaymentQr(
    session: TableSessionDoc,
    orderId: string,
  ): Promise<{
    orderId: string;
    orderNumber: string;
    amount: number;
    qrPayload: string;
    bank: { bin: string; name: string; accountNumber: string; accountName: string };
    memo: string;
  }> {
    return this.tenantCtx.run(
      {
        tenantId: session.tenantId,
        userId: null,
        venueId: session.venueId,
        permissions: [],
      },
      async () => {
        const order = await this.orders.findByIdOrFail(orderId);
        if (order.venueId !== session.venueId) {
          throw new BadRequestException({
            code: 'ORDER_NOT_IN_VENUE',
            message: 'Đơn không thuộc cơ sở này.',
          });
        }
        if (!session.orderIds.includes(orderId)) {
          throw new BadRequestException({
            code: 'ORDER_NOT_IN_SESSION',
            message: 'Đơn này không thuộc bàn của bạn.',
          });
        }
        if (order.status === 'paid' || order.status === 'cancelled') {
          throw new BadRequestException({
            code: 'ORDER_NOT_PAYABLE',
            message: 'Đơn đã thanh toán hoặc đã huỷ.',
          });
        }

        const venue = await this.venues.findByIdOrFail(session.venueId);
        const bank = venue.settings.bankAccount;
        if (!bank?.bankBin || !bank?.accountNumber) {
          throw new BadRequestException({
            code: 'NO_BANK_ACCOUNT',
            message: 'Quán chưa cấu hình tài khoản nhận tiền. Vui lòng thanh toán tại quầy.',
          });
        }

        // Memo dùng để khớp giao dịch — phải unique và search được trong sao kê
        const memo = `OG${order.orderNumber.replace(/-/g, '').slice(-12)}`;

        const qrPayload = buildVietQrPayload({
          bankBin: bank.bankBin,
          accountNumber: bank.accountNumber,
          accountName: bank.accountName ?? venue.name,
          amount: order.pricing.total.amount,
          memo,
        });

        return {
          orderId: order.id,
          orderNumber: order.orderNumber,
          amount: order.pricing.total.amount,
          qrPayload,
          bank: {
            bin: bank.bankBin,
            name: bank.bankName ?? '',
            accountNumber: bank.accountNumber,
            accountName: bank.accountName ?? venue.name,
          },
          memo,
        };
      },
    );
  }

  /** List orders trong session — cho khách track */
  async listSessionOrders(session: TableSessionDoc): Promise<OrderDoc[]> {
    return this.tenantCtx.run(
      {
        tenantId: session.tenantId,
        userId: null,
        venueId: session.venueId,
        permissions: [],
      },
      async () => {
        if (session.orderIds.length === 0) return [];
        return this.orders.find({ id: { $in: session.orderIds } }, { sort: { createdAt: -1 } });
      },
    );
  }
}

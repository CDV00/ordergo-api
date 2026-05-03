import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoyaltyCardDoc, tierFromLifetimeSpent } from './schemas/loyalty-card.schema';
import { LoyaltyTxDoc } from './schemas/loyalty-transaction.schema';
import { newId } from '../../shared/utils/uuid';
import { CustomerRepository } from '../customer/repositories/customer.repository';

/**
 * Quy đổi điểm: 1.000đ = 1 điểm (đơn vị tích).
 * Customer chỉ tích điểm khi status='verified' (có phone).
 * Anonymous customer KHÔNG tích — phải claim trước.
 */
const VND_PER_POINT = 1000;

@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger('Loyalty');

  constructor(
    @InjectModel(LoyaltyCardDoc.name) private readonly cards: Model<LoyaltyCardDoc>,
    @InjectModel(LoyaltyTxDoc.name) private readonly txs: Model<LoyaltyTxDoc>,
    private readonly customers: CustomerRepository,
  ) {}

  async getCard(tenantId: string, customerId: string): Promise<LoyaltyCardDoc | null> {
    return this.cards
      .findOne({ tenantId, customerId, deletedAt: null })
      .lean<LoyaltyCardDoc>()
      .exec();
  }

  /** Tự tạo card nếu chưa có (lazy issue khi customer earn lần đầu) */
  async ensureCard(tenantId: string, customerId: string): Promise<LoyaltyCardDoc> {
    const existing = await this.getCard(tenantId, customerId);
    if (existing) return existing;
    const now = new Date();
    const cardNumber = `OG-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;
    const card = await this.cards.create({
      id: newId(),
      tenantId,
      customerId,
      cardNumber,
      tier: 'bronze',
      points: 0,
      pointsLifetime: 0,
      spentLifetime: 0,
      issuedAt: now,
      expiresAt: null,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    return card.toObject() as LoyaltyCardDoc;
  }

  /** Tính points từ amount (VND) */
  pointsForAmount(amount: number): number {
    return Math.floor(amount / VND_PER_POINT);
  }

  /**
   * Earn điểm khi order paid. Idempotent qua referenceId — gọi lại không double-credit.
   */
  async earnFromOrder(params: {
    tenantId: string;
    customerId: string;
    orderId: string;
    orderTotal: number;
  }): Promise<LoyaltyCardDoc | null> {
    // Customer phải verified
    const customer = await this.customers.findById(params.customerId);
    if (!customer || customer.status === 'anonymous') {
      this.logger.debug(`Skip loyalty for anonymous customer ${params.customerId}`);
      return null;
    }

    // Idempotency check
    const existingTx = await this.txs
      .findOne({
        tenantId: params.tenantId,
        customerId: params.customerId,
        referenceType: 'order',
        referenceId: params.orderId,
        type: 'earn',
      })
      .lean()
      .exec();
    if (existingTx) {
      this.logger.debug(`Order ${params.orderId} already earned points`);
      return this.getCard(params.tenantId, params.customerId);
    }

    const points = this.pointsForAmount(params.orderTotal);
    if (points <= 0) return null;

    const card = await this.ensureCard(params.tenantId, params.customerId);
    const newPoints = card.points + points;
    const newLifetime = card.pointsLifetime + points;
    const newSpent = card.spentLifetime + params.orderTotal;
    const newTier = tierFromLifetimeSpent(newSpent);

    await this.cards
      .updateOne(
        { id: card.id },
        {
          $set: {
            points: newPoints,
            pointsLifetime: newLifetime,
            spentLifetime: newSpent,
            tier: newTier,
            updatedAt: new Date(),
          },
        },
      )
      .exec();

    await this.txs.create({
      id: newId(),
      tenantId: params.tenantId,
      cardId: card.id,
      customerId: params.customerId,
      type: 'earn',
      points,
      reason: `Order ${params.orderId}`,
      referenceType: 'order',
      referenceId: params.orderId,
      balanceAfter: newPoints,
      createdAt: new Date(),
      createdBy: null,
    });

    this.logger.log(
      `Earned ${points} pts cho customer ${params.customerId} (order ${params.orderId}), new balance: ${newPoints}, tier: ${newTier}`,
    );

    return {
      ...card,
      points: newPoints,
      pointsLifetime: newLifetime,
      spentLifetime: newSpent,
      tier: newTier,
    };
  }

  async listTransactions(
    tenantId: string,
    customerId: string,
    limit = 20,
  ): Promise<LoyaltyTxDoc[]> {
    return this.txs
      .find({ tenantId, customerId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<LoyaltyTxDoc[]>()
      .exec();
  }
}

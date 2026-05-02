import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OrderEventDoc } from '../schemas/order-event.schema';
import { newId } from '../../../shared/utils/uuid';

@Injectable()
export class OrderEventRepository {
  constructor(
    @InjectModel(OrderEventDoc.name) private readonly model: Model<OrderEventDoc>,
  ) {}

  async append(data: {
    tenantId: string;
    eventType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<OrderEventDoc> {
    const doc = await this.model.create({
      id: newId(),
      tenantId: data.tenantId,
      eventType: data.eventType,
      aggregateType: 'Order',
      aggregateId: data.aggregateId,
      payload: data.payload,
      metadata: data.metadata ?? {},
      occurredAt: new Date(),
      publishedAt: null,
      attempts: 0,
      lastError: null,
    });
    return doc.toObject() as OrderEventDoc;
  }
}

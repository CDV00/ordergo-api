import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TableSessionDoc } from '../schemas/table-session.schema';
import { newId } from '../../../shared/utils/uuid';

const SESSION_TTL_HOURS = 6;

@Injectable()
export class TableSessionRepository {
  constructor(
    @InjectModel(TableSessionDoc.name)
    private readonly model: Model<TableSessionDoc>,
  ) {}

  async findById(id: string): Promise<TableSessionDoc | null> {
    return this.model.findOne({ id, deletedAt: null }).lean<TableSessionDoc>().exec();
  }

  async findActiveByTable(
    tenantId: string,
    venueId: string,
    tableId: string,
  ): Promise<TableSessionDoc | null> {
    return this.model
      .findOne({
        tenantId,
        venueId,
        tableId,
        status: 'open',
        deletedAt: null,
      })
      .lean<TableSessionDoc>()
      .exec();
  }

  async create(data: {
    tenantId: string;
    venueId: string;
    tableId: string;
    tableName: string;
    openedBy?: 'qr_scan' | 'staff' | 'reservation';
    metadata?: { firstScanIp?: string; firstScanUserAgent?: string };
  }): Promise<TableSessionDoc> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_HOURS * 60 * 60 * 1000);
    const doc = await this.model.create({
      id: newId(),
      tenantId: data.tenantId,
      venueId: data.venueId,
      tableId: data.tableId,
      tableName: data.tableName,
      status: 'open',
      openedBy: data.openedBy ?? 'qr_scan',
      openedAt: now,
      expiresAt,
      lastActivityAt: now,
      customerIds: [],
      orderIds: [],
      orderCount: 0,
      totalAmount: { amount: 0, currency: 'VND' },
      paidAmount: { amount: 0, currency: 'VND' },
      metadata: {
        firstScanIp: data.metadata?.firstScanIp ?? null,
        firstScanUserAgent: data.metadata?.firstScanUserAgent ?? null,
        deviceFingerprints: [],
      },
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    return doc.toObject() as TableSessionDoc;
  }

  async addCustomer(sessionId: string, customerId: string): Promise<void> {
    await this.model
      .updateOne(
        { id: sessionId },
        {
          $addToSet: { customerIds: customerId },
          $set: { lastActivityAt: new Date(), updatedAt: new Date() },
        },
      )
      .exec();
  }

  async recordOrder(sessionId: string, orderId: string, orderTotal: number): Promise<void> {
    await this.model
      .updateOne(
        { id: sessionId },
        {
          $addToSet: { orderIds: orderId },
          $inc: {
            orderCount: 1,
            'totalAmount.amount': orderTotal,
          },
          $set: { lastActivityAt: new Date(), updatedAt: new Date() },
        },
      )
      .exec();
  }

  async recordPayment(sessionId: string, amount: number): Promise<void> {
    await this.model
      .updateOne(
        { id: sessionId },
        {
          $inc: { 'paidAmount.amount': amount },
          $set: { lastActivityAt: new Date(), updatedAt: new Date() },
        },
      )
      .exec();
  }

  async close(sessionId: string): Promise<void> {
    const now = new Date();
    await this.model
      .updateOne({ id: sessionId }, { $set: { status: 'closed', closedAt: now, updatedAt: now } })
      .exec();
  }

  async touch(sessionId: string): Promise<void> {
    await this.model.updateOne({ id: sessionId }, { $set: { lastActivityAt: new Date() } }).exec();
  }
}

import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  userId: string | null;
  tenantId: string | null;
  venueId: string | null;
  permissions: string[];
}

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantContext>();

  run<T>(ctx: TenantContext, fn: () => T): T {
    return this.storage.run(ctx, fn);
  }

  current(): TenantContext | undefined {
    return this.storage.getStore();
  }

  required(): TenantContext {
    const ctx = this.current();
    if (!ctx) throw new Error('TenantContext not set — middleware missing?');
    return ctx;
  }

  tenantId(): string {
    const id = this.required().tenantId;
    if (!id) throw new Error('No tenantId in context — endpoint requires authenticated tenant');
    return id;
  }

  userId(): string {
    const id = this.required().userId;
    if (!id) throw new Error('No userId in context — endpoint requires authentication');
    return id;
  }

  optionalTenantId(): string | null {
    return this.current()?.tenantId ?? null;
  }
}

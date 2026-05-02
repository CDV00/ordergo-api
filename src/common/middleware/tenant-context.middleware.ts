import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { TenantContextService, TenantContext } from '../context/tenant-context.service';

export interface JwtPayload {
  sub: string;
  tenantId: string | null;
  venueId: string | null;
  permissions?: string[];
}

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantCtx: TenantContextService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const ctx: TenantContext = {
      userId: null,
      tenantId: null,
      venueId: null,
      permissions: [],
    };

    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const token = auth.substring(7);
      try {
        const payload = this.jwt.verify<JwtPayload>(token, {
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        });
        ctx.userId = payload.sub;
        ctx.tenantId = payload.tenantId;
        ctx.venueId = payload.venueId;
        ctx.permissions = payload.permissions ?? [];
      } catch {
        // invalid token → leave ctx empty; JwtAuthGuard sẽ reject 401 ở endpoint protected
      }
    }

    // Header override (cho user multi-tenant chuyển tenant trong cùng JWT)
    const headerTenant = req.headers['x-tenant-id'];
    if (typeof headerTenant === 'string' && headerTenant) ctx.tenantId = headerTenant;
    const headerVenue = req.headers['x-venue-id'];
    if (typeof headerVenue === 'string' && headerVenue) ctx.venueId = headerVenue;

    this.tenantCtx.run(ctx, () => next());
  }
}

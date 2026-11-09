import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtPayload } from '../middleware/tenant-context.middleware';
import { TenantContextService } from '../context/tenant-context.service';
import { TenantAccessService } from '../../modules/tenant/tenant-access.service';
import type { AuthenticatedRequest } from '../decorators/current-user.decorator';

function headerValue(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly tenantCtx: TenantContextService,
    private readonly tenantAccess: TenantAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Bạn cần đăng nhập để thực hiện thao tác này.',
      });
    }

    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(auth.substring(7), {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.',
      });
    }

    // Đối chiếu tenant/venue (JWT + header) với membership thật → 403 nếu không thuộc về user.
    const access = await this.tenantAccess.resolve(payload.sub, {
      jwtTenantId: payload.tenantId,
      jwtVenueId: payload.venueId,
      headerTenantId: headerValue(req.headers['x-tenant-id']),
      headerVenueId: headerValue(req.headers['x-venue-id']),
    });

    // Cập nhật context của request (cùng object trong AsyncLocalStorage mà repository đọc).
    const store = this.tenantCtx.current();
    if (store) {
      store.userId = payload.sub;
      store.tenantId = access.tenantId;
      store.venueId = access.venueId;
      store.permissions = access.permissions;
    }

    req.user = {
      userId: payload.sub,
      tenantId: access.tenantId,
      venueId: access.venueId,
      permissions: access.permissions,
    };
    return true;
  }
}

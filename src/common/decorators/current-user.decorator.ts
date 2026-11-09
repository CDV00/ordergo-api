import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface CurrentUserPayload {
  userId: string;
  tenantId: string | null;
  venueId: string | null;
  permissions: string[];
}

/** Request sau JwtAuthGuard: `user` được gắn khi endpoint không @Public(). */
export type AuthenticatedRequest = Request & { user?: CurrentUserPayload };

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.user as CurrentUserPayload;
  },
);

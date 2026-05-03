import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { TableSessionRepository } from '../../table-session/repositories/table-session.repository';
import { TableSessionDoc } from '../../table-session/schemas/table-session.schema';

export const SESSION_COOKIE_NAME = 'ordergo_session';
export const CUSTOMER_COOKIE_NAME = 'ordergo_customer';

export interface PublicSessionContext {
  session: TableSessionDoc;
  customerId: string | null;
}

declare module 'express' {
  interface Request {
    publicSession?: PublicSessionContext;
  }
}

/**
 * Guard cho mọi endpoint /public/sessions/:sessionId/*.
 * Validate cookie ordergo_session khớp param sessionId, session còn open.
 */
@Injectable()
export class PublicSessionGuard implements CanActivate {
  constructor(private readonly sessions: TableSessionRepository) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const sessionIdParam = req.params.sessionId;
    const cookieSessionId = parseSessionCookie(req);

    if (!sessionIdParam) {
      throw new UnauthorizedException({
        code: 'NO_SESSION',
        message: 'Phiên không hợp lệ.',
      });
    }

    if (cookieSessionId && cookieSessionId !== sessionIdParam) {
      // Cookie nói khác — vẫn cho phép nhưng không trust customer
      // (case khách scan QR mới sau khi rời quán)
    }

    const session = await this.sessions.findById(sessionIdParam);
    if (!session || session.status === 'closed') {
      throw new UnauthorizedException({
        code: 'SESSION_CLOSED',
        message: 'Phiên này đã đóng. Vui lòng quét lại QR.',
      });
    }

    const customerId = parseCustomerCookie(req);
    req.publicSession = { session, customerId };
    return true;
  }
}

function parseSessionCookie(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] ?? null;
}

function parseCustomerCookie(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[CUSTOMER_COOKIE_NAME] ?? null;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const [k, ...v] = pair.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

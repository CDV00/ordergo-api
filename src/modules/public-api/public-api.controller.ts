import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { PublicApiService } from './public-api.service';
import {
  CUSTOMER_COOKIE_NAME,
  PublicSessionContext,
  PublicSessionGuard,
  SESSION_COOKIE_NAME,
} from './guards/public-session.guard';
import { PublicCreateOrderDto, PublicPaymentRequestDto } from './dto/public-order.dto';
import { RequestOtpDto, VerifyOtpClaimDto } from './dto/claim.dto';
import { RATE_LIMITS, RateLimit } from '../../common/throttle/throttle';

const COOKIE_MAX_AGE_SEC = 6 * 60 * 60; // 6h
const CUSTOMER_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30d

function setCookie(res: Response, name: string, value: string, maxAgeSec: number) {
  const opts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=/`,
    `Max-Age=${maxAgeSec}`,
    `SameSite=Lax`,
    `HttpOnly`,
  ];
  if (process.env.NODE_ENV === 'production') opts.push('Secure');
  res.append('Set-Cookie', opts.join('; '));
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

@ApiTags('Public — QR Customer')
@Public() // bypass JwtAuthGuard global
@Controller('public')
export class PublicApiController {
  constructor(private readonly service: PublicApiService) {}

  /**
   * Entry khi khách scan QR. URL: /public/qr/{tenantSlug}/{tableId}
   * - Resolve tenant + table
   * - Get/create session + anonymous customer
   * - Set cookies
   * - Return session info để FE redirect đến /m/.../menu
   */
  @Post('qr/:tenantSlug/:tableId')
  @RateLimit(RATE_LIMITS.publicQr)
  async scan(
    @Param('tenantSlug') tenantSlug: string,
    @Param('tableId') tableId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies = parseCookies(req.headers.cookie);
    const result = await this.service.scan({
      tenantSlug,
      tableId,
      cookieSessionId: cookies[SESSION_COOKIE_NAME] ?? null,
      cookieAnchor: cookies[CUSTOMER_COOKIE_NAME] ?? null,
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? undefined,
    });

    setCookie(res, SESSION_COOKIE_NAME, result.session.id, COOKIE_MAX_AGE_SEC);
    if (result.customer.cookieAnchor) {
      setCookie(
        res,
        CUSTOMER_COOKIE_NAME,
        result.customer.cookieAnchor,
        CUSTOMER_COOKIE_MAX_AGE_SEC,
      );
    }

    return {
      session: {
        id: result.session.id,
        tableName: result.session.tableName,
        venueId: result.session.venueId,
        status: result.session.status,
        orderCount: result.session.orderCount,
        totalAmount: result.session.totalAmount,
      },
      customer: {
        id: result.customer.id,
        status: result.customer.status,
        name: result.customer.name,
      },
      isNewSession: result.isNewSession,
      isNewCustomer: result.isNewCustomer,
    };
  }

  @Get('sessions/:sessionId')
  @UseGuards(PublicSessionGuard)
  getSession(@Req() req: Request) {
    const ctx = req.publicSession as PublicSessionContext;
    return {
      id: ctx.session.id,
      tableName: ctx.session.tableName,
      venueId: ctx.session.venueId,
      status: ctx.session.status,
      orderCount: ctx.session.orderCount,
      totalAmount: ctx.session.totalAmount,
      paidAmount: ctx.session.paidAmount,
    };
  }

  @Get('sessions/:sessionId/menu')
  @UseGuards(PublicSessionGuard)
  async getMenu(@Req() req: Request) {
    const ctx = req.publicSession as PublicSessionContext;
    return this.service.getMenu(ctx.session);
  }

  @Post('sessions/:sessionId/orders')
  @RateLimit(RATE_LIMITS.publicQr)
  @UseGuards(PublicSessionGuard)
  async createOrder(@Req() req: Request, @Body() dto: PublicCreateOrderDto) {
    const ctx = req.publicSession as PublicSessionContext;
    if (ctx.session.status !== 'open') {
      throw new BadRequestException({
        code: 'SESSION_NOT_OPEN',
        message: 'Phiên đã đóng. Vui lòng quét lại QR.',
      });
    }
    return this.service.createOrder(ctx.session, ctx.customerId, dto);
  }

  @Get('sessions/:sessionId/orders')
  @UseGuards(PublicSessionGuard)
  async listOrders(@Req() req: Request) {
    const ctx = req.publicSession as PublicSessionContext;
    return this.service.listSessionOrders(ctx.session);
  }

  // ─── Customer claim flow ────────────────────────────────────────────
  // (KHÔNG bind sessionId vì khách có thể claim ngoài session bất kỳ)

  @Post('auth/otp/request')
  @RateLimit(RATE_LIMITS.otpRequest) // + OtpService: 1 OTP/SĐT/30s
  async requestOtp(@Body() dto: RequestOtpDto, @Req() req: Request) {
    return this.service.requestClaimOtp(dto.phone, req.ip);
  }

  @Post('sessions/:sessionId/claim')
  @RateLimit(RATE_LIMITS.publicQr)
  @UseGuards(PublicSessionGuard)
  async claimWithOtp(@Req() req: Request, @Body() dto: VerifyOtpClaimDto) {
    const ctx = req.publicSession as PublicSessionContext;
    return this.service.verifyClaimOtp({
      sessionId: ctx.session.id,
      customerId: ctx.customerId,
      phone: dto.phone,
      code: dto.code,
      name: dto.name,
    });
  }

  @Post('sessions/:sessionId/orders/:orderId/payment-qr')
  @RateLimit(RATE_LIMITS.publicQr)
  @UseGuards(PublicSessionGuard)
  async generatePaymentQr(@Req() req: Request, @Param('orderId') orderId: string) {
    const ctx = req.publicSession as PublicSessionContext;
    return this.service.generatePaymentQr(ctx.session, orderId);
  }

  /** Khách báo đã chuyển khoản / muốn trả tại quầy → hiện ở "Chờ xác nhận" trên màn Thanh toán. */
  @Post('sessions/:sessionId/orders/:orderId/payment-request')
  @RateLimit(RATE_LIMITS.publicQr)
  @UseGuards(PublicSessionGuard)
  async requestPayment(
    @Req() req: Request,
    @Param('orderId') orderId: string,
    @Body() dto: PublicPaymentRequestDto,
  ) {
    const ctx = req.publicSession as PublicSessionContext;
    return this.service.requestPayment(ctx.session, orderId, dto.method);
  }

  @Get('sessions/:sessionId/me')
  @UseGuards(PublicSessionGuard)
  async getMe(@Req() req: Request) {
    const ctx = req.publicSession as PublicSessionContext;
    if (!ctx.customerId) {
      return null;
    }
    const customer = await this.service.getCustomerSelf(ctx.customerId);
    if (!customer) return null;
    return {
      id: customer.id,
      status: customer.status,
      name: customer.name,
      phone: customer.phone,
      stats: customer.stats,
    };
  }
}

import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { UserRepository } from './repositories/user.repository';
import { RefreshTokenRepository } from './repositories/refresh-token.repository';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { MembershipRepository } from '../tenant/repositories/membership.repository';
import { TenantRepository } from '../tenant/repositories/tenant.repository';
import { UserDoc } from './schemas/user.schema';
import { newId } from '../../shared/utils/uuid';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: string;
}

export interface AuthResult {
  user: PublicUser;
  tokens: IssuedTokens;
  membership: {
    tenantId: string | null;
    venueId: string | null;
    roleCode: string | null;
    permissions: string[];
  };
  needsSetup: boolean;
}

export interface PublicUser {
  id: string;
  phone: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  status: string;
}

function toPublic(u: UserDoc): PublicUser {
  return {
    id: u.id,
    phone: u.phone,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    status: u.status,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: RefreshTokenRepository,
    private readonly memberships: MembershipRepository,
    private readonly tenants: TenantRepository,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const phone = this.normalizePhone(dto.phone);
    const existing = await this.users.findByPhone(phone);
    if (existing) {
      throw new ConflictException({
        code: 'PHONE_TAKEN',
        message: 'Số điện thoại đã được đăng ký.',
      });
    }
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.users.create({
      phone,
      email: dto.email ?? null,
      passwordHash,
      displayName: dto.displayName,
    });
    return this.buildAuthResult(user);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const phone = this.normalizePhone(dto.phone);
    const user = await this.users.findByPhone(phone);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Số điện thoại hoặc mật khẩu không đúng.',
      });
    }
    const ok = await argon2.verify(user.passwordHash, dto.password).catch(() => false);
    if (!ok) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Số điện thoại hoặc mật khẩu không đúng.',
      });
    }
    await this.users.updateLastLogin(user.id);
    return this.buildAuthResult(user);
  }

  async refresh(rawToken: string): Promise<IssuedTokens> {
    const stored = await this.tokens.findActive(rawToken);
    if (!stored) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Phiên đã hết hạn, vui lòng đăng nhập lại.',
      });
    }
    const user = await this.users.findById(stored.userId);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException({
        code: 'USER_DISABLED',
        message: 'Tài khoản đã bị khoá.',
      });
    }
    // Rotate
    await this.tokens.revoke(rawToken);
    const memberships = await this.memberships.findActiveByUser(user.id);
    const primary = memberships[0];
    return this.issueTokens(user, primary);
  }

  /** Đổi mật khẩu → thu hồi mọi refresh token (đăng xuất các thiết bị khác). */
  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const user = await this.users.findById(userId);
    const ok = user ? await argon2.verify(user.passwordHash, current).catch(() => false) : false;
    if (!user || !ok) {
      throw new UnauthorizedException({
        code: 'WRONG_PASSWORD',
        message: 'Mật khẩu hiện tại không đúng.',
      });
    }
    await this.users.updatePasswordHash(userId, await argon2.hash(next, { type: argon2.argon2id }));
    await this.tokens.revokeAllForUser(userId);
  }

  async logout(rawToken: string | null): Promise<void> {
    if (rawToken) await this.tokens.revoke(rawToken);
  }

  async me(userId: string): Promise<{
    user: PublicUser;
    memberships: Awaited<ReturnType<MembershipRepository['findActiveByUser']>>;
    tenants: Array<{
      id: string;
      name: string;
      slug: string;
      status: string;
    }>;
  }> {
    const u = await this.users.findById(userId);
    if (!u) {
      throw new UnauthorizedException({
        code: 'USER_NOT_FOUND',
        message: 'Không tìm thấy tài khoản.',
      });
    }
    const memberships = await this.memberships.findActiveByUser(userId);

    // Hydrate tenant info — cần slug cho features như QR generation
    const tenantIds = [...new Set(memberships.map((m) => m.tenantId))];
    const tenantDocs = await Promise.all(tenantIds.map((id) => this.tenants.findById(id)));
    const validDocs = tenantDocs.filter((t): t is NonNullable<typeof t> => t !== null);

    // Lazy backfill: tenant cũ tạo trước khi schema có `slug` field → auto generate
    const hydrated = await Promise.all(validDocs.map((t) => this.tenants.ensureSlug(t)));

    const tenants = hydrated.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
    }));

    return { user: toPublic(u), memberships, tenants };
  }

  private async buildAuthResult(user: UserDoc): Promise<AuthResult> {
    const memberships = await this.memberships.findActiveByUser(user.id);
    const primary = memberships[0];
    const tokens = await this.issueTokens(user, primary);
    return {
      user: toPublic(user),
      tokens,
      membership: {
        tenantId: primary?.tenantId ?? null,
        venueId: primary?.venueId ?? null,
        roleCode: primary?.roleCode ?? null,
        permissions: primary?.permissions ?? [],
      },
      needsSetup: !primary,
    };
  }

  private async issueTokens(
    user: UserDoc,
    primary: Awaited<ReturnType<MembershipRepository['findActiveByUser']>>[number] | undefined,
  ): Promise<IssuedTokens> {
    const accessTtl = this.config.get<string>('JWT_ACCESS_TTL') ?? '15m';
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL') ?? '30d';

    const payload = {
      sub: user.id,
      tenantId: primary?.tenantId ?? null,
      venueId: primary?.venueId ?? null,
      permissions: primary?.permissions ?? [],
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: accessTtl as unknown as number,
    });

    const refreshRaw = `${newId()}.${randomBytes(32).toString('base64url')}`;
    const refreshExpiresAt = this.parseTtlToDate(refreshTtl);
    await this.tokens.create({
      userId: user.id,
      rawToken: refreshRaw,
      expiresAt: refreshExpiresAt,
    });

    return { accessToken, refreshToken: refreshRaw, accessExpiresIn: accessTtl };
  }

  private parseTtlToDate(ttl: string): Date {
    const m = /^(\d+)([smhd])$/.exec(ttl.trim());
    const now = Date.now();
    if (!m) return new Date(now + 30 * 24 * 60 * 60 * 1000);
    const n = parseInt(m[1], 10);
    const unit = m[2];
    const ms =
      unit === 's'
        ? n * 1000
        : unit === 'm'
          ? n * 60_000
          : unit === 'h'
            ? n * 3_600_000
            : n * 86_400_000;
    return new Date(now + ms);
  }

  normalizePhone(p: string): string {
    let s = p.trim();
    if (s.startsWith('0')) s = '+84' + s.substring(1);
    if (!s.startsWith('+')) s = '+' + s;
    return s;
  }
}

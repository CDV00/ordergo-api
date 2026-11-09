import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../../common/middleware/tenant-context.middleware';
import { ResolvedAccess, TenantAccessService } from '../tenant/tenant-access.service';
import { TableSessionRepository } from '../table-session/repositories/table-session.repository';
import { RealtimeEvent, tableRoom, tenantRoom, venueRoom } from './realtime.rooms';

interface HandshakeAuth {
  /** Nhân viên: access token + tenant/venue đang chọn (giống header X-Tenant-Id / X-Venue-Id) */
  token?: string;
  tenantId?: string;
  venueId?: string;
  /** Khách QR: id phiên bàn (chính là "chìa khoá" của trang gọi món công khai) */
  sessionId?: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Kênh realtime. Socket chỉ NHẬN sự kiện; mọi thao tác vẫn đi qua REST (đã có guard/permission).
 * Xác thực ở handshake, cùng luật với JwtAuthGuard: tenant/venue phải khớp membership trong DB.
 * CORS cấu hình ở `RealtimeIoAdapter` (lấy từ CORS_ORIGINS).
 */
@WebSocketGateway({ namespace: '/realtime' })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger('Realtime');

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly tenantAccess: TenantAccessService,
    private readonly sessions: TableSessionRepository,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const auth = (client.handshake.auth ?? {}) as HandshakeAuth;
    try {
      const rooms = auth.token
        ? await this.staffRooms(auth)
        : auth.sessionId
          ? await this.publicRooms(str(auth.sessionId))
          : null;
      if (!rooms) throw new Error('UNAUTHENTICATED');
      await client.join(rooms);
      client.emit(RealtimeEvent.Ready, { rooms: rooms.length });
    } catch (err) {
      const code = err instanceof Error ? err.message : 'UNAUTHENTICATED';
      this.logger.debug(`Từ chối socket ${client.id}: ${code}`);
      client.emit('realtime.error', { code });
      client.disconnect(true);
    }
  }

  private async staffRooms(auth: HandshakeAuth): Promise<string[]> {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(auth.token!, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new Error('INVALID_TOKEN');
    }
    let access: ResolvedAccess;
    try {
      access = await this.tenantAccess.resolve(payload.sub, {
        jwtTenantId: payload.tenantId,
        jwtVenueId: payload.venueId,
        headerTenantId: str(auth.tenantId),
        headerVenueId: str(auth.venueId),
      });
    } catch {
      throw new Error('FORBIDDEN');
    }
    if (!access.tenantId) throw new Error('NO_TENANT');
    return access.venueId
      ? [venueRoom(access.tenantId, access.venueId)]
      : [tenantRoom(access.tenantId)];
  }

  private async publicRooms(sessionId: string | null): Promise<string[]> {
    if (!sessionId) throw new Error('NO_SESSION');
    const session = await this.sessions.findById(sessionId);
    if (!session || session.status === 'closed' || !session.tableId) {
      throw new Error('SESSION_CLOSED');
    }
    return [tableRoom(session.tenantId, session.tableId)];
  }

  /** Gửi tới nhân viên của venue + owner toàn tenant (socket.io tự khử trùng giữa các room). */
  emitToVenue(tenantId: string, venueId: string, event: string, payload: unknown): void {
    if (!this.server) return;
    this.server.to([venueRoom(tenantId, venueId), tenantRoom(tenantId)]).emit(event, payload);
  }

  emitToTable(tenantId: string, tableId: string, event: string, payload: unknown): void {
    if (!this.server) return;
    this.server.to(tableRoom(tenantId, tableId)).emit(event, payload);
  }
}

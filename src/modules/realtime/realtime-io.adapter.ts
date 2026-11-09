import type { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/** Socket.IO adapter dùng chung danh sách CORS_ORIGINS với REST. */
export class RealtimeIoAdapter extends IoAdapter {
  private readonly origins: string[];

  constructor(app: INestApplicationContext) {
    super(app);
    const config = app.get(ConfigService);
    this.origins = (config.get<string>('CORS_ORIGINS') ?? 'http://localhost:3000')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins, credentials: true },
      // Payload realtime rất nhỏ — giới hạn để tránh lạm dụng
      maxHttpBufferSize: 16 * 1024,
    });
  }
}

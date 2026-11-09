import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ConnectionStates } from 'mongoose';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../decorators/public.decorator';

@ApiTags('Health')
@SkipThrottle() // healthcheck của Docker/Caddy/uptime monitor không bị rate limit
@Controller()
export class HealthController {
  constructor(@InjectConnection() private readonly mongo: Connection) {}

  @Public()
  @Get('health')
  live() {
    return { status: 'ok', uptime: process.uptime() };
  }

  @Public()
  @Get('health/ready')
  /** 200 khi sẵn sàng nhận request; 503 khi chưa kết nối Mongo (load balancer / dashboard dựa vào mã này). */
  ready() {
    const ok = this.mongo.readyState === ConnectionStates.connected;
    if (!ok) {
      throw new ServiceUnavailableException({
        code: 'NOT_READY',
        message: 'Chưa kết nối được cơ sở dữ liệu.',
        details: { mongo: `state_${this.mongo.readyState}` },
      });
    }
    return { status: 'ready', mongo: 'connected' };
  }
}

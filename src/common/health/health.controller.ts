import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { Public } from '../decorators/public.decorator';

@ApiTags('Health')
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
  async ready() {
    // 1 = connected, 2 = connecting
    const ok = this.mongo.readyState === 1;
    return {
      status: ok ? 'ready' : 'not_ready',
      mongo: ok ? 'connected' : `state_${this.mongo.readyState}`,
    };
  }
}

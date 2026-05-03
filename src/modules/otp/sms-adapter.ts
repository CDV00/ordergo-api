import { Injectable, Logger } from '@nestjs/common';

export interface SmsAdapter {
  send(phone: string, message: string): Promise<void>;
}

/**
 * Dev adapter — log code to console.
 * Production: thay bằng EsmsAdapter / FptSmsAdapter (cần API key).
 */
@Injectable()
export class ConsoleSmsAdapter implements SmsAdapter {
  private readonly logger = new Logger('SMS');

  async send(phone: string, message: string): Promise<void> {
    this.logger.warn(`📱 SMS to ${phone}: ${message}`);
  }
}

export const SMS_ADAPTER = Symbol('SMS_ADAPTER');

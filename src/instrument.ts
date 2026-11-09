/**
 * Import ĐẦU TIÊN trong main.ts: khởi tạo Sentry trước khi nạp Nest/Express.
 * Đọc biến môi trường thật (file .env chưa được ConfigModule nạp ở thời điểm này).
 * Không có SENTRY_DSN → không làm gì.
 */
import { initSentry } from './common/observability/sentry';

initSentry();

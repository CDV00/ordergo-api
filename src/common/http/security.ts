import type { NextFunction, Request, RequestHandler, Response } from 'express';
import helmet from 'helmet';

/** Giới hạn body JSON / urlencoded. Upload ảnh (multipart, ≤2MB) do multer xử lý riêng. */
export const JSON_BODY_LIMIT = '100kb';

export const SWAGGER_PATH = 'api-docs';

/**
 * TRUST_PROXY → giá trị cho `app.set('trust proxy', ...)`.
 * ""/"0"/"false" → false; "true" → true; "2" → 2; còn lại (IP/subnet/"loopback") giữ nguyên chuỗi.
 */
export function parseTrustProxy(raw: string | undefined | null): boolean | number | string {
  const v = (raw ?? '').trim();
  const lower = v.toLowerCase();
  if (v === '' || v === '0' || lower === 'false') return false;
  if (lower === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

/** Swagger: mặc định bật ngoài production; SWAGGER_ENABLED ghi đè khi được đặt. */
export function isSwaggerEnabled(nodeEnv: string | undefined, flag: boolean | undefined): boolean {
  if (flag !== undefined) return flag;
  return nodeEnv !== 'production';
}

/**
 * Helmet: API chỉ trả JSON → CSP chặt (`default-src 'none'`). Riêng Swagger UI (/api-docs) cần
 * script/style của chính nó → CSP mặc định của helmet (script 'self', style 'unsafe-inline').
 * CORP mặc định same-origin; /uploads tự đặt `cross-origin` (app.setup.ts) để web khác origin
 * nhúng được ảnh.
 */
export function securityHeaders(): RequestHandler {
  const apiHelmet = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
  });
  const docsHelmet = helmet({
    contentSecurityPolicy: {
      directives: {
        imgSrc: ["'self'", 'data:', 'https:'],
        // Dev chạy http://localhost — không ép nâng script/fetch lên https.
        upgradeInsecureRequests: null,
      },
    },
  });
  const docsPrefix = `/${SWAGGER_PATH}`;
  return (req: Request, res: Response, next: NextFunction) => {
    const isDocs = req.path === docsPrefix || req.path.startsWith(`${docsPrefix}/`);
    return (isDocs ? docsHelmet : apiHelmet)(req, res, next);
  };
}

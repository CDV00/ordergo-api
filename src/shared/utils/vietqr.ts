/**
 * VietQR EMV TLV builder — chuẩn NAPAS QR cho chuyển khoản 24/7.
 * Output là chuỗi text → render bằng QR generator (FE dùng qrcode.react).
 *
 * Ref: https://vietqr.io/qrcode/structure
 */

interface VietQrInput {
  /** BIN ngân hàng (vd: 970422 = MB, 970436 = Vietcombank) */
  bankBin: string;
  /** Số tài khoản */
  accountNumber: string;
  /** Tên chủ TK (≤ 25 ký tự, không dấu cho an toàn) */
  accountName?: string;
  /** Số tiền VND (integer) — undefined = static QR, có amount = dynamic */
  amount?: number;
  /** Nội dung chuyển khoản (≤ 25 ký tự) */
  memo?: string;
}

function tlv(id: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return id + len + value;
}

function crc16ccitt(s: string): string {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Strip Vietnamese diacritics + non-ASCII cho field name/memo */
function asciiSafe(s: string, maxLen: number): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7E]/g, '')
    .substring(0, maxLen)
    .trim();
}

export function buildVietQrPayload(input: VietQrInput): string {
  let payload = '';

  // 00 — Payload Format Indicator
  payload += tlv('00', '01');

  // 01 — Point of Initiation Method (12 = dynamic, 11 = static)
  payload += tlv('01', input.amount ? '12' : '11');

  // 38 — Merchant Account Information (NAPAS)
  let merchantInfo = '';
  merchantInfo += tlv('00', 'A000000727'); // GUI NAPAS

  let bankInfo = '';
  bankInfo += tlv('00', input.bankBin);
  bankInfo += tlv('01', input.accountNumber);
  merchantInfo += tlv('01', bankInfo);

  merchantInfo += tlv('02', 'QRIBFTTA'); // Service: account transfer
  payload += tlv('38', merchantInfo);

  // 53 — Currency: 704 = VND
  payload += tlv('53', '704');

  // 54 — Amount (optional)
  if (input.amount && input.amount > 0) {
    payload += tlv('54', String(Math.round(input.amount)));
  }

  // 58 — Country
  payload += tlv('58', 'VN');

  // 59 — Merchant name
  if (input.accountName) {
    payload += tlv('59', asciiSafe(input.accountName, 25));
  }

  // 60 — City
  payload += tlv('60', 'VIETNAM');

  // 62 — Additional Data Field
  if (input.memo) {
    const purpose = tlv('08', asciiSafe(input.memo, 25));
    payload += tlv('62', purpose);
  }

  // 63 — CRC: append marker "6304" then compute over full string up to and including marker
  const withCrcMarker = payload + '6304';
  const crc = crc16ccitt(withCrcMarker);
  return withCrcMarker + crc;
}

/**
 * Validate BIN — 6 chữ số. Danh sách BIN phổ biến VN.
 * Tham khảo full: https://api.vietqr.io/v2/banks
 */
export const VN_BANK_BINS: Record<string, string> = {
  '970422': 'MBBank',
  '970436': 'Vietcombank',
  '970418': 'BIDV',
  '970415': 'VietinBank',
  '970432': 'VPBank',
  '970407': 'Techcombank',
  '970448': 'OCB',
  '970454': 'VietCapitalBank',
  '970403': 'Sacombank',
  '970423': 'TPBank',
  '970416': 'ACB',
  '970437': 'HDBank',
};

export function isValidBin(bin: string): boolean {
  return /^\d{6}$/.test(bin);
}

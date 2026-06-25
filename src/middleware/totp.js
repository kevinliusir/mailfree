/**
 * TOTP 二次验证核心算法（RFC 6238 / RFC 4648 base32），纯 Web Crypto，兼容 Cloudflare Workers。
 * @module middleware/totp
 */

import { hashPassword, verifyPassword } from './auth.js';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 字节数组 → base32（无填充） */
export function base32Encode(bytes) {
  let bits = 0, val = 0, out = '';
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

/** base32 → 字节数组（忽略大小写/空白/填充） */
export function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0, val = 0; const out = [];
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    val = (val << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

/** 生成随机 base32 密钥（默认 20 字节 = 160 bit，RFC 推荐） */
export function generateSecret(bytes = 20) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base32Encode(buf);
}

/** 计算指定时间步的 TOTP 码（HMAC-SHA1，6 位） */
export async function totpCode(secretB32, step, digits = 6) {
  const key = base32Decode(secretB32);
  const msg = new ArrayBuffer(8);
  const dv = new DataView(msg);
  dv.setUint32(0, Math.floor(step / 0x100000000));
  dv.setUint32(4, step >>> 0);
  const ck = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', ck, msg));
  const off = sig[sig.length - 1] & 0x0f;
  const bin = ((sig[off] & 0x7f) << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** 校验 TOTP 码，接受 ±window 个 30s 窗口（容时钟漂移） */
export async function verifyTotp(secretB32, code, window = 1) {
  if (!secretB32 || !/^\d{6}$/.test(String(code || ''))) return false;
  const step = Math.floor(Date.now() / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    if (timingSafeEqual(await totpCode(secretB32, step + w), String(code))) return true;
  }
  return false;
}

/** 生成 otpauth:// URI，供前端渲染二维码 */
export function otpauthUri(account, secretB32, issuer = 'Mailman') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** 恒定时间字符串比较 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** 生成 n 个一次性备份码（格式 XXXX-XXXX，base32 字符） */
export function generateBackupCodes(n = 10) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const b = new Uint8Array(5);
    crypto.getRandomValues(b);
    const s = base32Encode(b).slice(0, 8);
    codes.push(`${s.slice(0, 4)}-${s.slice(4, 8)}`);
  }
  return codes;
}

/** 哈希备份码（复用 PBKDF2），返回哈希数组 */
export async function hashBackupCodes(plainCodes) {
  return Promise.all(plainCodes.map((c) => hashPassword(c)));
}

/** 校验并消费一个备份码：命中则返回 {ok:true, remaining:[剩余哈希]}，否则 {ok:false, remaining:原样} */
export async function consumeBackupCode(hashedList, input) {
  const code = String(input || '').trim().toUpperCase();
  const list = Array.isArray(hashedList) ? hashedList : [];
  for (let i = 0; i < list.length; i++) {
    const r = await verifyPassword(code, list[i]);
    if (r?.valid) {
      const remaining = list.slice();
      remaining.splice(i, 1);
      return { ok: true, remaining };
    }
  }
  return { ok: false, remaining: list };
}

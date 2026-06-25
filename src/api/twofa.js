/**
 * 2FA（TOTP）管理 API：状态 / 绑定 / 解绑 / 管理员重置。
 * 当前账号身份取自 options.authPayload（user/admin 用 userId，mailbox 用 mailboxId）。
 * @module api/twofa
 */

import { getJwtPayload, isStrictAdmin, errorResponse, jsonResponse } from './helpers.js';
import { generateSecret, otpauthUri, verifyTotp, generateBackupCodes, hashBackupCodes, consumeBackupCode } from '../middleware/totp.js';
import {
  getUserTotp, setUserTotp, clearUserTotp,
  getMailboxTotp, setMailboxTotp, clearMailboxTotp
} from '../db/index.js';

// 按账号失败冷却（per-isolate，缓解验证码爆破）
const failMap = new Map();
function tkey(p) { return p.role === 'mailbox' ? 'm:' + p.mailboxId : 'u:' + p.userId; }
function allowAttempt(key) { const e = failMap.get(key); return !(e && e.until > Date.now()); }
function recordFail(key) {
  const e = failMap.get(key) || { count: 0, until: 0 };
  e.count++;
  if (e.count >= 5) { e.until = Date.now() + 60_000; e.count = 0; }
  failMap.set(key, e);
}

function acct(payload) {
  if (payload.role === 'mailbox') {
    return { kind: 'mailbox', id: Number(payload.mailboxId), label: payload.mailboxAddress || ('mailbox#' + payload.mailboxId) };
  }
  return { kind: 'user', id: Number(payload.userId), label: payload.username || ('user#' + payload.userId) };
}
const readTotp = (db, a) => (a.kind === 'mailbox' ? getMailboxTotp(db, a.id) : getUserTotp(db, a.id));
const writeTotp = (db, a, cfg) => (a.kind === 'mailbox' ? setMailboxTotp(db, a.id, cfg) : setUserTotp(db, a.id, cfg));
const clearTotp = (db, a) => (a.kind === 'mailbox' ? clearMailboxTotp(db, a.id) : clearUserTotp(db, a.id));

export async function handleTwoFaApi(request, db, url, path, options) {
  if (!path.startsWith('/api/2fa')) return null;
  const payload = getJwtPayload(request, options);
  if (!payload) return errorResponse('未认证', 401);
  const method = request.method;

  // 当前账号 2FA 状态
  if (path === '/api/2fa/status' && method === 'GET') {
    const cfg = await readTotp(db, acct(payload));
    return jsonResponse({ enabled: !!cfg?.enabled });
  }

  // 生成密钥（不落库，待 enable 确认）
  if (path === '/api/2fa/setup' && method === 'POST') {
    const a = acct(payload);
    const secret = generateSecret();
    return jsonResponse({ secret, otpauthUri: otpauthUri(a.label, secret) });
  }

  // 开启：验证码通过 → 落库 + 回显一次性备份码
  if (path === '/api/2fa/enable' && method === 'POST') {
    const a = acct(payload);
    if (!allowAttempt(tkey(payload))) return errorResponse('尝试过于频繁，请稍后再试', 429);
    let body; try { body = await request.json(); } catch (_) { return errorResponse('Bad Request', 400); }
    const secret = String(body.secret || '');
    const code = String(body.code || '').trim();
    if (!secret || !(await verifyTotp(secret, code))) { recordFail(tkey(payload)); return errorResponse('验证码错误', 400); }
    const backupPlain = generateBackupCodes(10);
    const backupHashed = await hashBackupCodes(backupPlain);
    await writeTotp(db, a, { secret, enabled: true, backupCodes: backupHashed });
    return jsonResponse({ success: true, backupCodes: backupPlain });
  }

  // 关闭：TOTP 码或备份码通过 → 清空
  if (path === '/api/2fa/disable' && method === 'POST') {
    const a = acct(payload);
    if (!allowAttempt(tkey(payload))) return errorResponse('尝试过于频繁，请稍后再试', 429);
    const cfg = await readTotp(db, a);
    if (!cfg?.enabled) return jsonResponse({ success: true });
    let body; try { body = await request.json(); } catch (_) { return errorResponse('Bad Request', 400); }
    const code = String(body.code || '').trim();
    let ok = await verifyTotp(cfg.secret, code);
    if (!ok) ok = (await consumeBackupCode(cfg.backupCodes || [], code)).ok;
    if (!ok) { recordFail(tkey(payload)); return errorResponse('验证码错误', 400); }
    await clearTotp(db, a);
    return jsonResponse({ success: true });
  }

  // 管理员重置他人 2FA（user 或 mailbox）
  if (path === '/api/2fa/reset' && method === 'POST') {
    if (!isStrictAdmin(request, options)) return errorResponse('需要管理员权限', 403);
    let body; try { body = await request.json(); } catch (_) { return errorResponse('Bad Request', 400); }
    if (String(body.role || '') === 'mailbox') {
      const id = Number(body.mailboxId || 0);
      if (!id) return errorResponse('缺少 mailboxId', 400);
      await clearMailboxTotp(db, id);
      return jsonResponse({ success: true });
    }
    const id = Number(body.userId || 0);
    if (!id) return errorResponse('缺少 userId', 400);
    await clearUserTotp(db, id);
    return jsonResponse({ success: true });
  }

  return null;
}

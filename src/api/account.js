/**
 * 账号自助 API：当前登录用户（admin/user）修改自己的密码。
 * mailbox 角色走 /api/mailbox/password（且被 mailboxOnly 白名单挡在外）。
 * @module api/account
 */

import { getJwtPayload, errorResponse, jsonResponse } from './helpers.js';
import { hashPassword, verifyPassword } from '../middleware/auth.js';

// 按账号失败冷却（per-isolate，缓解爆破）
const failMap = new Map();
const tkey = (p) => 'u:' + (p.userId || p.username || '');
const allowAttempt = (k) => { const e = failMap.get(k); return !(e && e.until > Date.now()); };
function recordFail(k) {
  const e = failMap.get(k) || { count: 0, until: 0 };
  e.count++;
  if (e.count >= 5) { e.until = Date.now() + 60_000; e.count = 0; }
  failMap.set(k, e);
}

export async function handleAccountApi(request, db, url, path, options) {
  if (path !== '/api/account/password' || request.method !== 'PUT') return null;

  const payload = getJwtPayload(request, options);
  if (!payload) return errorResponse('未认证', 401);
  if (payload.role === 'mailbox') return errorResponse('邮箱账号请在邮箱页修改密码', 400);

  const userId = Number(payload.userId || 0);
  if (!userId) return errorResponse('未找到账号信息', 401);
  if (!allowAttempt(tkey(payload))) return errorResponse('尝试过于频繁，请稍后再试', 429);

  let body;
  try { body = await request.json(); } catch (_) { return errorResponse('Bad Request', 400); }
  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');
  if (!currentPassword || !newPassword) return errorResponse('当前密码和新密码不能为空', 400);
  if (newPassword.length < 6) return errorResponse('新密码长度至少6位', 400);

  const row = await db.prepare('SELECT id, password_hash FROM users WHERE id = ?').bind(userId).first();
  if (!row) return errorResponse('账号不存在', 404);

  let valid = false;
  if (row.password_hash) {
    const r = await verifyPassword(currentPassword, row.password_hash);
    valid = !!r?.valid;
  }
  // admin：env 密码作为有效“当前密码”（兜底；也覆盖 DB 尚未设密码的首次改密）
  if (!valid && payload.role === 'admin' && options.adminPassword) {
    valid = currentPassword === options.adminPassword;
  }
  if (!valid) { recordFail(tkey(payload)); return errorResponse('当前密码错误', 400); }

  const newHash = await hashPassword(newPassword);
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, userId).run();
  return jsonResponse({ success: true, message: '密码修改成功' });
}

/**
 * 认证相关路由：登录（两步）、登出、会话
 * @module routes/auth
 */

import { Hono } from 'hono';
import {
  getInitializedDatabase,
  getUserTotp, getMailboxTotp, setUserTotp, setMailboxTotp
} from '../db/index.js';
import {
  createJwt, buildSessionCookie, verifyMailboxLogin, verifyPassword,
  createShortToken, verifyShortToken
} from '../middleware/auth.js';
import { verifyTotp, consumeBackupCode } from '../middleware/totp.js';
import { rateLimiter } from '../middleware/app.js';
import { invalidateSystemStatCache } from '../utils/cache.js';

const router = new Hono();

// MFA ticket 用与 session 不同的派生密钥签名，确保 ticket 不能被当 session 使用
const mfaSecret = (env) => (env.JWT_TOKEN || env.JWT_SECRET || '') + '|mfa';

// 已消费的 ticket jti（per-isolate，防重放：成功换取 session 后该 ticket 作废）
const usedJti = new Map();
function jtiConsumed(jti) {
  if (!jti) return false;
  const now = Date.now();
  if (usedJti.size > 256) { for (const [k, exp] of usedJti) if (exp <= now) usedJti.delete(k); }
  const exp = usedJti.get(jti);
  return !!(exp && exp > now);
}
function consumeJti(jti) { if (jti) usedJti.set(jti, Date.now() + 6 * 60_000); }

/** 签发正式 session cookie 并返回响应 */
async function finishLogin(c, sessionPayload, expireDays, respBody) {
  const JWT_TOKEN = c.env.JWT_TOKEN || c.env.JWT_SECRET || '';
  const token = await createJwt(JWT_TOKEN, sessionPayload, expireDays);
  c.header('Set-Cookie', buildSessionCookie(token, c.req.url, expireDays));
  return c.json({ success: true, ...respBody });
}

/** 第一步通过但需 2FA：发 5 分钟 ticket，不发 session */
async function issueMfaTicket(c, ticketPayload) {
  const ticket = await createShortToken(mfaSecret(c.env), { stage: 'mfa', jti: crypto.randomUUID(), ...ticketPayload }, 300);
  return c.json({ success: true, mfaRequired: true, ticket });
}

router.post('/api/logout', (c) => {
  const u = new URL(c.req.url);
  const isHttps = (u.protocol === 'https:');
  c.header('Set-Cookie', `iding-session=; HttpOnly;${isHttps ? ' Secure;' : ''} Path=/; SameSite=Strict; Max-Age=0`);
  return c.json({ success: true });
});

router.post('/api/login', rateLimiter({ windowMs: 60_000, max: 10 }), async (c) => {
  let DB;
  try { DB = await getInitializedDatabase(c.env); } catch (_) { return c.text('数据库连接失败', 500); }

  const ADMIN_NAME = String(c.env.ADMIN_NAME || 'admin').trim().toLowerCase();
  const ADMIN_PASSWORD = c.env.ADMIN_PASSWORD || c.env.ADMIN_PASS || '';
  const SESSION_EXPIRE_DAYS = parseInt(c.env.SESSION_EXPIRE_DAYS, 10) || 7;

  let body;
  try { body = await c.req.json(); } catch (_) { return c.text('Bad Request', 400); }

  const name = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '').trim();
  if (!name || !password) return c.text('用户名或密码不能为空', 400);

  // 管理员
  if (name === ADMIN_NAME && ADMIN_PASSWORD && password === ADMIN_PASSWORD) {
    let adminUserId = 0;
    try {
      const u = await DB.prepare('SELECT id FROM users WHERE username = ?').bind(ADMIN_NAME).all();
      if (u?.results?.length) {
        adminUserId = Number(u.results[0].id);
      } else {
        await DB.prepare("INSERT INTO users (username, role, can_send, mailbox_limit) VALUES (?, 'admin', 1, 9999)")
          .bind(ADMIN_NAME).run();
        invalidateSystemStatCache('user_stats');
        const again = await DB.prepare('SELECT id FROM users WHERE username = ?').bind(ADMIN_NAME).all();
        adminUserId = Number(again?.results?.[0]?.id || 0);
      }
    } catch (_) { adminUserId = 0; }

    const totp = await getUserTotp(DB, adminUserId);
    const resp = { role: 'admin', can_send: 1, mailbox_limit: 9999 };
    if (totp?.enabled) return issueMfaTicket(c, { role: 'admin', username: ADMIN_NAME, userId: adminUserId, can_send: 1, mailbox_limit: 9999 });
    return finishLogin(c, { role: 'admin', username: ADMIN_NAME, userId: adminUserId }, SESSION_EXPIRE_DAYS, resp);
  }

  // 普通用户
  try {
    const { results } = await DB.prepare(
      'SELECT id, password_hash, role, mailbox_limit, can_send FROM users WHERE username = ?'
    ).bind(name).all();
    if (results?.length) {
      const row = results[0];
      const pwResult = await verifyPassword(password, row.password_hash || '');
      if (pwResult.valid) {
        const role = (row.role === 'admin') ? 'admin' : 'user';
        // 旧版 SHA-256 哈希自动迁移到 PBKDF2
        if (pwResult.newHash) {
          try { await DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(pwResult.newHash, row.id).run(); }
          catch (_) { /* 迁移失败不影响登录 */ }
        }
        const canSend = role === 'admin' ? 1 : (row.can_send ? 1 : 0);
        const mailboxLimit = role === 'admin' ? (row.mailbox_limit || 20) : (row.mailbox_limit || 10);
        const totp = await getUserTotp(DB, row.id);
        if (totp?.enabled) return issueMfaTicket(c, { role, username: name, userId: row.id, can_send: canSend, mailbox_limit: mailboxLimit });
        return finishLogin(c, { role, username: name, userId: row.id }, SESSION_EXPIRE_DAYS, { role, can_send: canSend, mailbox_limit: mailboxLimit });
      }
    }
  } catch (_) { /* 继续 */ }

  // 邮箱登录
  try {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name)) {
      const info = await verifyMailboxLogin(name, password, DB);
      if (info) {
        const totp = await getMailboxTotp(DB, info.id);
        if (totp?.enabled) return issueMfaTicket(c, { role: 'mailbox', username: name, mailboxId: info.id, mailboxAddress: info.address });
        return finishLogin(c,
          { role: 'mailbox', username: name, mailboxId: info.id, mailboxAddress: info.address },
          SESSION_EXPIRE_DAYS,
          { role: 'mailbox', mailbox: info.address, can_send: 0, mailbox_limit: 1 });
      }
    }
  } catch (_) { /* 继续 */ }

  return c.text('用户名或密码错误', 401);
});

// 登录第二步失败的按账号冷却（per-isolate，补充 IP 限流，防分布式来源绕过）
const mfaFail = new Map();
const mfaAllow = (k) => { const e = mfaFail.get(k); return !(e && e.until > Date.now()); };
function mfaRecordFail(k) { const e = mfaFail.get(k) || { count: 0, until: 0 }; e.count++; if (e.count >= 5) { e.until = Date.now() + 60_000; e.count = 0; } mfaFail.set(k, e); }

// 登录第二步：校验 TOTP 码 / 备份码
router.post('/api/login/2fa', rateLimiter({ windowMs: 60_000, max: 10 }), async (c) => {
  let DB;
  try { DB = await getInitializedDatabase(c.env); } catch (_) { return c.text('数据库连接失败', 500); }
  const SESSION_EXPIRE_DAYS = parseInt(c.env.SESSION_EXPIRE_DAYS, 10) || 7;

  let body;
  try { body = await c.req.json(); } catch (_) { return c.text('Bad Request', 400); }
  const ticket = String(body.ticket || '');
  const code = String(body.code || '').trim();

  const p = await verifyShortToken(mfaSecret(c.env), ticket);
  if (!p || p.stage !== 'mfa') return c.text('登录态失效，请重新登录', 401);

  const fkey = p.role === 'mailbox' ? 'm:' + p.mailboxId : 'u:' + p.userId;
  if (!mfaAllow(fkey)) return c.text('尝试过于频繁，请稍后再试', 429);

  const isMailbox = p.role === 'mailbox';
  const totp = isMailbox ? await getMailboxTotp(DB, p.mailboxId) : await getUserTotp(DB, p.userId);
  if (!totp?.enabled) return c.text('该账号未启用两步验证', 400);

  let ok = await verifyTotp(totp.secret, code);
  if (!ok) {
    const r = await consumeBackupCode(totp.backupCodes || [], code);
    if (r.ok) {
      ok = true;
      // 备份码一次性：持久化剩余
      if (isMailbox) await setMailboxTotp(DB, p.mailboxId, { secret: totp.secret, enabled: true, backupCodes: r.remaining });
      else await setUserTotp(DB, p.userId, { secret: totp.secret, enabled: true, backupCodes: r.remaining });
    }
  }
  if (!ok) { mfaRecordFail(fkey); return c.text('验证码错误', 401); }

  // 防重放：ticket 一次性，成功换取 session 后即作废
  if (jtiConsumed(p.jti)) return c.text('登录态已失效，请重新登录', 401);
  consumeJti(p.jti);

  if (isMailbox) {
    return finishLogin(c,
      { role: 'mailbox', username: p.username, mailboxId: p.mailboxId, mailboxAddress: p.mailboxAddress },
      SESSION_EXPIRE_DAYS,
      { role: 'mailbox', mailbox: p.mailboxAddress, can_send: 0, mailbox_limit: 1 });
  }
  return finishLogin(c,
    { role: p.role, username: p.username, userId: p.userId },
    SESSION_EXPIRE_DAYS,
    { role: p.role, can_send: p.can_send, mailbox_limit: p.mailbox_limit });
});

export default router;

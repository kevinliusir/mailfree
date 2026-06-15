/**
 * 邮件转发模块
 * @module email/forwarder
 */

import { sendEmailWithAutoResend } from './sender.js';
import { extractEmail } from '../utils/common.js';

// 转发标记头：转发出去的邮件会带上它，收到带此标记的邮件不再转发，避免环路
const FORWARD_HEADER = 'X-Freemail-Forwarded';

/**
 * 根据收件人本地部分前缀转发邮件
 * @param {object} message - 邮件消息对象
 * @param {string} localPart - 收件人的本地部分
 * @param {object} ctx - 上下文对象
 * @param {object} env - 环境变量对象
 */
export function forwardByLocalPart(message, localPart, ctx, env) {
  const rules = parseForwardRules(env?.FORWARD_RULES);
  const target = resolveTargetEmail(localPart, rules);
  if (!target) return;
  try {
    ctx.waitUntil(message.forward(target));
  } catch (e) {
    console.error('Forward error:', e);
  }
}

/**
 * 解析转发规则字符串
 * @param {string} rulesRaw - 原始规则字符串
 * @returns {Array<object>} 标准化的规则数组
 */
function parseForwardRules(rulesRaw) {
  if (rulesRaw === undefined || rulesRaw === null) {
    return [];
  }
  const trimmed = String(rulesRaw).trim();
  if (
    trimmed === '' ||
    trimmed === '[]' ||
    trimmed.toLowerCase() === 'disabled' ||
    trimmed.toLowerCase() === 'none'
  ) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return normalizeRules(parsed);
    }
  } catch (_) {
    // 非 JSON → 按 kv 语法解析
  }
  const rules = [];
  for (const pair of trimmed.split(',')) {
    const [prefix, email] = pair.split('=').map(s => (s || '').trim());
    if (!prefix || !email) continue;
    rules.push({ prefix, email });
  }
  return normalizeRules(rules);
}

/**
 * 标准化规则数组
 * @param {Array<object>} items - 原始规则项数组
 * @returns {Array<object>} 标准化后的规则数组
 */
function normalizeRules(items) {
  const result = [];
  for (const it of items) {
    const prefix = String(it.prefix || '').toLowerCase();
    const email = String(it.email || '').trim();
    if (!prefix || !email) continue;
    result.push({ prefix, email });
  }
  return result;
}

/**
 * 根据本地部分和规则解析目标邮箱地址
 * @param {string} localPart - 收件人的本地部分
 * @param {Array<object>} rules - 转发规则数组
 * @returns {string|null} 目标邮箱地址
 */
function resolveTargetEmail(localPart, rules) {
  const lp = String(localPart || '').toLowerCase();
  for (const r of rules) {
    if (r.prefix === '*') continue;
    if (lp.startsWith(r.prefix)) return r.email;
  }
  const wildcard = rules.find(r => r.prefix === '*');
  return wildcard ? wildcard.email : null;
}

/**
 * 根据邮箱数据库配置转发邮件
 *
 * 优先通过 Resend 重发（目标邮箱无需在 Cloudflare 验证）；
 * 未配置 Resend（或缺少发件地址）时回退到 Cloudflare 原生 message.forward()，
 * 后者要求目标地址已在 Cloudflare 验证。
 *
 * @param {object} message - 邮件消息对象
 * @param {string} forwardTo - 数据库中配置的转发目标地址
 * @param {object} ctx - 上下文对象
 * @param {object} [options] - Resend 重发所需的内容与配置
 * @param {string} [options.resendApiKey] - Resend API Key
 * @param {string} [options.fromAddress] - 重发使用的发件地址（须在 Resend 已验证的域名下）
 * @param {string} [options.originalSender] - 原始发件人 From 头（用于显示名与 Reply-To）
 * @param {string} [options.subject] - 原始主题
 * @param {string} [options.html] - 原始 HTML 正文
 * @param {string} [options.text] - 原始纯文本正文
 * @returns {boolean} 是否成功触发转发
 */
export function forwardByMailboxConfig(message, forwardTo, ctx, options = {}) {
  if (!forwardTo || typeof forwardTo !== 'string') return false;
  const target = forwardTo.trim();
  if (!target) return false;

  // 防转发环路：已带转发标记的邮件不再转发
  try {
    if (message?.headers?.get && message.headers.get(FORWARD_HEADER)) {
      console.log('检测到转发标记，跳过转发以防环路');
      return false;
    }
  } catch (_) { /* ignore */ }

  const { resendApiKey, fromAddress } = options;

  // 优先通过 Resend 重发（目标无需在 Cloudflare 验证）
  if (resendApiKey && fromAddress) {
    ctx.waitUntil(
      resendForward(target, fromAddress, options)
        .then(() => console.log(`邮件已通过 Resend 转发至: ${target}`))
        .catch(e => console.error('Resend 转发失败:', e?.message || e))
    );
    return true;
  }

  // 回退：Cloudflare 原生转发（要求目标已在 Cloudflare 验证）
  try {
    ctx.waitUntil(message.forward(target));
    console.log(`邮件已转发至: ${target} (Cloudflare 原生)`);
    return true;
  } catch (e) {
    console.error('邮箱配置转发失败:', e);
    return false;
  }
}

/**
 * 解码 MIME 编码词（RFC 2047），如 `=?utf-8?B?6aqM6K+B56CB?=` → `验证码`。
 * 支持 B(base64) 与 Q(quoted-printable) 编码及任意字符集；解码失败时原样返回。
 * @param {string} str - 原始头部值（可能含一个或多个编码词）
 * @returns {string} 解码后的可读文本
 */
function decodeMimeHeader(str) {
  if (!str) return '';
  // 合并相邻编码词之间的空白（RFC 2047：编码词之间的空白应被忽略）
  const s = String(str).replace(/\?=\s+=\?/g, '?==?');
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, charset, enc, text) => {
    try {
      let bytes;
      if (enc.toUpperCase() === 'B') {
        const bin = atob(text);
        bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      } else {
        const qp = text
          .replace(/_/g, ' ')
          .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
        bytes = Uint8Array.from(qp, c => c.charCodeAt(0));
      }
      return new TextDecoder(String(charset).toLowerCase()).decode(bytes);
    } catch (_) {
      return m; // 解码失败保留原文
    }
  });
}

/**
 * 解析 From 头，提取显示名与邮箱地址
 * @param {string} fromHeader - 原始 From 头，如 `张三 <a@b.com>`
 * @returns {{name: string, email: string}}
 */
function parseSender(fromHeader) {
  const raw = String(fromHeader || '').trim();
  const email = extractEmail(raw) || '';
  let name = '';
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*</);
  if (m && m[1]) name = decodeMimeHeader(m[1].trim());
  return { name, email };
}

/**
 * 通过 Resend 重发实现转发
 * @param {string} target - 转发目标地址
 * @param {string} fromAddress - 发件地址（须为 Resend 已验证域名）
 * @param {object} options - 转发内容（originalSender/subject/html/text/resendApiKey）
 * @returns {Promise<object>} Resend 返回结果
 */
async function resendForward(target, fromAddress, options) {
  const { resendApiKey, originalSender, subject, html, text } = options;
  const { name, email } = parseSender(originalSender);

  // 发件人显示名带上原始发件人，明确这是一封转发邮件
  const displayName = name
    ? `${name} (转发)`
    : (email ? `${email} (转发)` : '转发');

  // 原始主题可能是 MIME 编码词（RFC 2047），先解码成可读文本
  let fwdSubject = decodeMimeHeader(subject) || '(无主题)';
  // 主题加 [转发] 前缀（已有则不重复）
  if (!/^\s*\[转发\]/.test(fwdSubject)) fwdSubject = `[转发] ${fwdSubject}`;

  const payload = {
    from: fromAddress,
    fromName: displayName,
    to: target,
    subject: fwdSubject,
    headers: { [FORWARD_HEADER]: '1' }
  };
  if (html) payload.html = html;
  if (text) payload.text = text;
  if (!html && !text) payload.text = '(无正文)';
  if (email) payload.replyTo = email; // 回复直接回到原始发件人

  // 复用与“发邮件”相同的发送路径：自动按发件域名解析 API Key
  // （兼容单个 re_xxx 密钥与多域名 JSON 配置）
  return await sendEmailWithAutoResend(resendApiKey, payload);
}

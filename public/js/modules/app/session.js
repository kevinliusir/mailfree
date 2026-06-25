/**
 * 会话管理模块
 * @module modules/app/session
 */

import { cacheGet, cacheSet, setCurrentUserKey } from '../../storage.js';

// 会话状态
let sessionData = null;

/**
 * 获取会话数据
 * @returns {object|null}
 */
export function getSession() {
  return sessionData;
}

/**
 * 设置会话数据
 * @param {object} data - 会话数据
 */
export function setSession(data) {
  sessionData = data;
}

/**
 * 检查是否为管理员
 * @returns {boolean}
 */
export function isAdmin() {
  return sessionData?.strictAdmin || sessionData?.role === 'admin';
}

/**
 * 检查是否为严格管理员
 * @returns {boolean}
 */
export function isStrictAdmin() {
  return sessionData?.strictAdmin === true;
}

/**
 * 应用会话 UI
 * @param {object} session - 会话数据
 */
export function applySessionUI(session) {
  try {
    const badge = document.getElementById('role-badge');
    if (badge) {
      badge.className = 'role-badge';
      if (session.strictAdmin) {
        badge.classList.add('role-super');
        badge.textContent = '超级管理员';
      } else if (session.role === 'admin') {
        badge.classList.add('role-admin');
        badge.textContent = `高级用户：${session.username || ''}`;
      } else if (session.role === 'user') {
        badge.classList.add('role-user');
        badge.textContent = `用户：${session.username || ''}`;
      }
    }

    const adminLink = document.getElementById('admin');
    const allMailboxesLink = document.getElementById('all-mailboxes');

    if (session && session.strictAdmin) {
      if (adminLink) adminLink.style.display = 'inline-flex';
      if (allMailboxesLink) allMailboxesLink.style.display = 'inline-flex';
    } else {
      if (adminLink) adminLink.style.display = 'none';
      if (allMailboxesLink) allMailboxesLink.style.display = 'none';
    }
  } catch(_) {}
}

/**
 * 初始化会话（从缓存）
 */
export function initSessionFromCache() {
  try {
    const cachedS = cacheGet('session', 24 * 60 * 60 * 1000);
    if (cachedS) {
      setCurrentUserKey(`${cachedS.role || ''}:${cachedS.username || ''}`);
      applySessionUI(cachedS);
      setSession(cachedS);
    }
  } catch(_) {}
}

/**
 * 验证会话
 * @returns {Promise<object|null>}
 */
export async function validateSession() {
  try {
    const r = await fetch('/api/session');
    if (!r.ok) {
      return null;
    }
    const s = await r.json();
    cacheSet('session', s);
    setCurrentUserKey(`${s.role || ''}:${s.username || ''}`);
    setSession(s);
    applySessionUI(s);
    return s;
  } catch(_) {
    return null;
  }
}

export default {
  getSession,
  setSession,
  isAdmin,
  isStrictAdmin,
  applySessionUI,
  initSessionFromCache,
  validateSession
};

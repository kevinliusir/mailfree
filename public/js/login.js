const username = document.getElementById('username');
const pwd = document.getElementById('pwd');
const btn = document.getElementById('login');
const err = document.getElementById('err');

let isSubmitting = false;
let mfaTicket = null; // 第一步通过、待二次验证时持有

// ensureToastContainer / showToast 由 toast-utils.js 统一提供

// 显示来自其他页面的提示消息
(function showLoginMessage() {
  const msg = sessionStorage.getItem('mf:login-message');
  if (msg) {
    sessionStorage.removeItem('mf:login-message');
    setTimeout(() => {
      if (typeof showToast === 'function') {
        showToast(msg, 'info');
      } else if (err) {
        err.textContent = msg;
        err.style.color = '#2563eb';
      }
    }, 300);
  }
})();

function getTarget() {
  try { const u = new URL(location.href); const t = (u.searchParams.get('redirect') || '').trim(); return t || '/'; }
  catch (_) { return '/'; }
}

function gotoByRole(role) {
  const target = getTarget();
  let finalTarget = target;
  if (role === 'mailbox') finalTarget = '/html/mailbox.html';
  else if (target === '/' && role === 'admin') finalTarget = '/';
  setTimeout(() => location.replace(finalTarget), 1000);
}

// 切换到二次验证输入
function enterMfaMode() {
  if (username) username.style.display = 'none';
  pwd.value = '';
  pwd.type = 'text';
  pwd.placeholder = '6 位验证码或备份码';
  pwd.setAttribute('autocomplete', 'one-time-code');
  pwd.focus();
  btn.textContent = '验证';
  err.style.color = '#2563eb';
  err.textContent = '请输入认证器的 6 位验证码（或备份码）';
}

async function doLogin() {
  if (isSubmitting) return;
  const user = (username.value || '').trim();
  const password = (pwd.value || '').trim();
  if (!user) { err.textContent = '用户名不能为空'; await showToast('用户名不能为空', 'warn'); return; }
  if (!password) { err.textContent = '密码不能为空'; await showToast('密码不能为空', 'warn'); return; }
  err.textContent = '';
  isSubmitting = true;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '正在登录…';

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password })
    });

    if (response.ok) {
      const result = await response.json();
      // 需要二次验证：切到验证码步骤，不跳转
      if (result.success && result.mfaRequired && result.ticket) {
        mfaTicket = result.ticket;
        enterMfaMode();
        isSubmitting = false;
        btn.disabled = false;
        return;
      }
      if (result.success) {
        await showToast('登录成功，正在跳转...', 'success');
        gotoByRole(result.role);
        return;
      }
    } else {
      const errorText = await response.text();
      err.textContent = errorText || '登录失败';
      await showToast(errorText || '登录失败', 'warn');
      isSubmitting = false; btn.disabled = false; btn.textContent = original;
      return;
    }
  } catch (e) {
    err.textContent = '网络错误，请重试';
    await showToast('网络连接失败，请检查网络后重试', 'warn');
  } finally {
    if (isSubmitting) { isSubmitting = false; btn.disabled = false; btn.textContent = original; }
  }
}

async function doVerify2fa() {
  if (isSubmitting) return;
  const code = (pwd.value || '').trim();
  if (!code) { err.textContent = '请输入验证码'; await showToast('请输入验证码', 'warn'); return; }
  err.textContent = '';
  isSubmitting = true;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '验证中…';

  try {
    const response = await fetch('/api/login/2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: mfaTicket, code })
    });

    if (response.ok) {
      const result = await response.json();
      if (result.success) {
        await showToast('验证成功，正在跳转...', 'success');
        gotoByRole(result.role);
        return;
      }
    } else {
      const errorText = await response.text();
      err.textContent = errorText || '验证失败';
      await showToast(errorText || '验证失败', 'warn');
      isSubmitting = false; btn.disabled = false; btn.textContent = original;
      // 登录态失效：重置回密码步骤
      if (response.status === 401 && /失效/.test(errorText)) {
        mfaTicket = null;
        setTimeout(() => location.reload(), 1200);
      }
      return;
    }
  } catch (e) {
    err.textContent = '网络错误，请重试';
    await showToast('网络连接失败，请检查网络后重试', 'warn');
  } finally {
    if (isSubmitting) { isSubmitting = false; btn.disabled = false; btn.textContent = original; }
  }
}

function handleSubmit() {
  if (mfaTicket) return doVerify2fa();
  return doLogin();
}

btn.addEventListener('click', handleSubmit);
pwd.addEventListener('keydown', e => { if (e.key === 'Enter') handleSubmit(); });
username.addEventListener('keydown', e => { if (e.key === 'Enter') handleSubmit(); });

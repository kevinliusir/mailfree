/* 账号自助修改密码 UI —— 自包含模态，适用于 app 页的 admin/user（mailbox 用邮箱页自带入口）。 */
(function () {
  const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t || 'info'); };
  function el(tag, attrs, html) { const e = document.createElement(tag); if (attrs) Object.assign(e, attrs); if (html != null) e.innerHTML = html; return e; }
  const inputStyle = 'width:100%;padding:12px;border:1px solid #e4e4e7;border-radius:6px;font-size:16px;margin-bottom:12px;box-sizing:border-box';
  function btnStyle(bg, color, border) { return `flex:1;padding:12px;border:${border};border-radius:6px;background:${bg};color:${color};font-size:15px;font-weight:600;cursor:pointer`; }

  let overlay;
  function close() { if (overlay) { overlay.remove(); overlay = null; } }
  function show(inner) {
    close();
    overlay = el('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000';
    const card = el('div');
    card.style.cssText = 'background:#fff;color:#18181b;border-radius:12px;padding:24px;width:min(92vw,400px);box-shadow:0 20px 60px rgba(0,0,0,.3)';
    card.appendChild(inner);
    overlay.appendChild(card);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  }

  function open() {
    const box = el('div');
    box.appendChild(el('h3', { style: 'margin:0 0 16px' }, '修改密码'));
    const cur = el('input', { type: 'password', placeholder: '当前密码', autocomplete: 'current-password' }); cur.style.cssText = inputStyle;
    const np = el('input', { type: 'password', placeholder: '新密码（至少 6 位）', autocomplete: 'new-password' }); np.style.cssText = inputStyle;
    const cf = el('input', { type: 'password', placeholder: '确认新密码', autocomplete: 'new-password' }); cf.style.cssText = inputStyle;
    box.appendChild(cur); box.appendChild(np); box.appendChild(cf);
    const actions = el('div', { style: 'display:flex;gap:8px' });
    const cancel = el('button', null, '取消'); cancel.style.cssText = btnStyle('#fff', '#18181b', '1px solid #e4e4e7');
    const confirm = el('button', null, '确认修改'); confirm.style.cssText = btnStyle('#2563eb', '#fff', 'none');
    actions.appendChild(cancel); actions.appendChild(confirm); box.appendChild(actions);
    show(box);
    cur.focus();
    cancel.onclick = close;

    confirm.onclick = async () => {
      const currentPassword = cur.value || '';
      const newPassword = np.value || '';
      if (!currentPassword) { toast('请输入当前密码', 'warn'); return; }
      if (newPassword.length < 6) { toast('新密码至少 6 位', 'warn'); return; }
      if (newPassword !== (cf.value || '')) { toast('两次新密码不一致', 'warn'); return; }
      confirm.disabled = true;
      try {
        const r = await fetch('/api/account/password', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword, newPassword })
        });
        if (r.ok) {
          close();
          toast('密码已修改，请重新登录', 'success');
          setTimeout(() => { fetch('/api/logout', { method: 'POST' }).finally(() => location.replace('/html/login.html')); }, 1200);
        } else {
          toast((await r.text()) || '修改失败', 'warn');
          confirm.disabled = false;
        }
      } catch (_) { toast('网络错误', 'warn'); confirm.disabled = false; }
    };
  }

  // 注入「修改密码」按钮到顶栏 .nav-actions（顶栏可能异步注入，重试若干次）
  function injectButton(tries) {
    const nav = document.querySelector('.nav-actions');
    if (nav) {
      if (!document.getElementById('acct-pwd-trigger')) {
        const b = el('button', { id: 'acct-pwd-trigger', className: 'btn btn-ghost', title: '修改密码' }, '<span class="btn-text">修改密码</span>');
        b.onclick = open;
        nav.insertBefore(b, nav.firstChild);
      }
      return;
    }
    if ((tries || 0) < 12) setTimeout(() => injectButton((tries || 0) + 1), 400);
  }

  window.openChangePasswordModal = open;
  if (document.readyState !== 'loading') injectButton(0);
  else document.addEventListener('DOMContentLoaded', () => injectButton(0));
})();

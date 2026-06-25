/* 两步验证（2FA / TOTP）自助绑定 UI —— 自包含模态，适用于 admin/user/mailbox。
   依赖：/js/vendor/qrcode.js（全局 qrcode 工厂）、toast-utils.js（showToast，可选）。 */
(function () {
  const api = (p, opt) => fetch(p, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opt || {}));
  const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t || 'info'); };
  function el(tag, attrs, html) { const e = document.createElement(tag); if (attrs) Object.assign(e, attrs); if (html != null) e.innerHTML = html; return e; }
  function btnStyle(bg, color, border) { return `flex:1;padding:12px;border:${border};border-radius:6px;background:${bg};color:${color};font-size:15px;font-weight:600;cursor:pointer`; }

  let overlay;
  function close() { if (overlay) { overlay.remove(); overlay = null; } }
  function show(inner) {
    close();
    overlay = el('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000';
    const card = el('div');
    card.style.cssText = 'background:#fff;color:#18181b;border-radius:12px;padding:24px;width:min(92vw,420px);max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)';
    card.appendChild(inner);
    overlay.appendChild(card);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  }

  async function open() {
    let status = { enabled: false };
    try { status = await api('/api/2fa/status').then(r => r.json()); } catch (_) {}
    if (status.enabled) renderDisable(); else renderSetup();
  }

  async function renderSetup() {
    const box = el('div');
    box.appendChild(el('h3', { style: 'margin:0 0 12px' }, '开启两步验证 (2FA)'));
    box.appendChild(el('p', { style: 'color:#71717a;font-size:13px;margin:0 0 16px' }, '用认证器 App（如 Google Authenticator）扫码或手动输入密钥，再输入 6 位码确认。'));
    const qrBox = el('div', { style: 'text-align:center;min-height:140px' }, '二维码生成中…');
    box.appendChild(qrBox);
    const secretBox = el('div', { style: 'font-family:monospace;font-size:13px;word-break:break-all;background:#fafafa;border:1px solid #e4e4e7;border-radius:6px;padding:8px;margin:12px 0' });
    box.appendChild(secretBox);
    const input = el('input', { type: 'text', placeholder: '6 位验证码', maxLength: 6, inputMode: 'numeric' });
    input.style.cssText = 'width:100%;padding:12px;border:1px solid #e4e4e7;border-radius:6px;font-size:16px;margin-bottom:12px;box-sizing:border-box';
    box.appendChild(input);
    const actions = el('div', { style: 'display:flex;gap:8px' });
    const cancel = el('button', null, '取消'); cancel.style.cssText = btnStyle('#fff', '#18181b', '1px solid #e4e4e7');
    const confirm = el('button', null, '确认开启'); confirm.style.cssText = btnStyle('#2563eb', '#fff', 'none');
    actions.appendChild(cancel); actions.appendChild(confirm); box.appendChild(actions);
    show(box);
    cancel.onclick = close;

    let secret = '';
    try {
      const r = await api('/api/2fa/setup', { method: 'POST', body: '{}' }).then(x => x.json());
      secret = r.secret;
      secretBox.textContent = '密钥：' + secret;
      try { const qr = qrcode(0, 'M'); qr.addData(r.otpauthUri); qr.make(); qrBox.innerHTML = qr.createImgTag(4, 8); }
      catch (_) { qrBox.textContent = '（二维码渲染失败，请用上方密钥手动添加）'; }
    } catch (_) { qrBox.textContent = '初始化失败，请重试'; }

    confirm.onclick = async () => {
      const code = (input.value || '').trim();
      if (!code) { toast('请输入验证码', 'warn'); return; }
      confirm.disabled = true;
      try {
        const r = await api('/api/2fa/enable', { method: 'POST', body: JSON.stringify({ secret, code }) });
        if (r.ok) { const j = await r.json(); renderBackup(j.backupCodes || []); }
        else { toast((await r.text()) || '开启失败', 'warn'); confirm.disabled = false; }
      } catch (_) { toast('网络错误', 'warn'); confirm.disabled = false; }
    };
  }

  function renderBackup(codes) {
    const box = el('div');
    box.appendChild(el('h3', { style: 'margin:0 0 12px;color:#16a34a' }, '✅ 两步验证已开启'));
    box.appendChild(el('p', { style: 'color:#71717a;font-size:13px;margin:0 0 12px' }, '请妥善保存以下备份码（每个仅可用一次），认证器丢失时可用它登录：'));
    box.appendChild(el('div', { style: 'font-family:monospace;font-size:14px;background:#fafafa;border:1px solid #e4e4e7;border-radius:6px;padding:12px;line-height:1.9;margin-bottom:12px' }, codes.join('<br>')));
    const done = el('button', null, '我已保存'); done.style.cssText = btnStyle('#2563eb', '#fff', 'none');
    box.appendChild(done); show(box);
    done.onclick = () => { close(); toast('两步验证已开启', 'success'); };
  }

  async function renderDisable() {
    const box = el('div');
    box.appendChild(el('h3', { style: 'margin:0 0 12px' }, '关闭两步验证'));
    box.appendChild(el('p', { style: 'color:#71717a;font-size:13px;margin:0 0 16px' }, '输入当前 6 位验证码（或备份码）以关闭 2FA。'));
    const input = el('input', { type: 'text', placeholder: '验证码 / 备份码' });
    input.style.cssText = 'width:100%;padding:12px;border:1px solid #e4e4e7;border-radius:6px;font-size:16px;margin-bottom:12px;box-sizing:border-box';
    box.appendChild(input);
    const actions = el('div', { style: 'display:flex;gap:8px' });
    const cancel = el('button', null, '取消'); cancel.style.cssText = btnStyle('#fff', '#18181b', '1px solid #e4e4e7');
    const confirm = el('button', null, '确认关闭'); confirm.style.cssText = btnStyle('#ef4444', '#fff', 'none');
    actions.appendChild(cancel); actions.appendChild(confirm); box.appendChild(actions);
    show(box); cancel.onclick = close;
    confirm.onclick = async () => {
      const code = (input.value || '').trim();
      if (!code) { toast('请输入验证码', 'warn'); return; }
      confirm.disabled = true;
      try {
        const r = await api('/api/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) });
        if (r.ok) { close(); toast('两步验证已关闭', 'success'); }
        else { toast((await r.text()) || '关闭失败', 'warn'); confirm.disabled = false; }
      } catch (_) { toast('网络错误', 'warn'); confirm.disabled = false; }
    };
  }

  // 自动把「两步验证」按钮注入顶栏 .nav-actions（顶栏可能异步注入，故重试若干次）
  function injectButton(tries) {
    const nav = document.querySelector('.nav-actions');
    if (nav) {
      if (!document.getElementById('tfa-trigger')) {
        const b = el('button', { id: 'tfa-trigger', className: 'btn btn-ghost', title: '两步验证' }, '<span class="btn-text">两步验证</span>');
        b.onclick = open;
        nav.insertBefore(b, nav.firstChild);
      }
      return;
    }
    if ((tries || 0) < 12) setTimeout(() => injectButton((tries || 0) + 1), 400);
  }

  window.openTwoFaModal = open;
  if (document.readyState !== 'loading') injectButton(0);
  else document.addEventListener('DOMContentLoaded', () => injectButton(0));
})();

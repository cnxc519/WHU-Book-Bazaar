/* WHU二手书市 网页版（零依赖原生 JS SPA，复用服务端全部 API） */
'use strict';

// ---------- 基础设施 ----------
const TOKEN_KEY = 'whu_token';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yuan = (fen) => '¥' + (fen / 100).toFixed(2);

function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }
function isLogin() { return !!getToken(); }

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

async function api(method, path, body, isForm) {
  const opt = { method, headers: {}, cache: 'no-store' };
  if (getToken()) opt.headers.Authorization = 'Bearer ' + getToken();
  if (body && isForm) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch('/api' + path, opt);
  const j = await r.json().catch(() => ({ ok: false, error: { msg: '网络异常，请稍后重试' } }));
  if (r.status === 401) { setToken(''); location.hash = '#/login'; render(); throw new Error(j.error?.msg || '请重新登录'); }
  if (!j.ok) throw new Error(j.error?.msg || '请求失败');
  return j.data;
}
const GET = (p) => api('GET', p);
const POST = (p, b) => api('POST', p, b);

// 图片压缩：最长边 maxDim，JPEG 质量自降至 maxKb 以内
function compressImage(file, maxDim, maxKb) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      let q = 0.85;
      const out = () => {
        const dataUrl = cv.toDataURL('image/jpeg', q);
        if ((dataUrl.length * 0.75 > maxKb * 1024) && q > 0.4) { q -= 0.15; out(); return; }
        resolve(dataUrl);
      };
      out();
    };
    img.onerror = () => reject(new Error('图片读取失败'));
    img.src = url;
  });
}
function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = head.match(/:(.*?);/)[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ---------- 时间显示 ----------
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'string' ? Date.parse(ts) : ts);
  if (isNaN(d)) return '';
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (d.toDateString() === now.toDateString()) return hm;
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hm;
}

// ---------- 实时推送（复用 App 的 WS 通道） ----------
let ws = null;
function wsConnect() {
  if (!isLogin() || (ws && ws.readyState <= 1)) return;
  try {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?token=' + getToken());
    ws.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.t === 'notif') { loadBell(); if (location.hash.startsWith('#/notifications')) render(); }
        if (ev.t === 'bchat' || ev.t === 'wchat') {
          loadMsgBadge();
          if (location.hash.startsWith('#/inbox')) render();
          const m = location.hash.match(/^#\/chat\/(?:wish\/|book\/)?(\d+)/);
          if (m && String(ev.chat_id) === m[1]) render();
        }
      } catch {}
    };
    ws.onclose = () => setTimeout(wsConnect, 5000);
  } catch {}
}

// 角标
async function loadBell() {
  if (!isLogin()) return;
  try {
    const d = await GET('/notifications');
    const b = $('#bell-badge');
    b.textContent = d.unread;
    b.classList.toggle('hidden', !d.unread);
  } catch {}
}
async function loadMsgBadge() {
  if (!isLogin()) return;
  try {
    // 书市聊天 + 心愿聊天未读相加（两模式共用一个消息 Tab）
    const [b, w] = await Promise.all([GET('/book-chats/unread-count'), GET('/wish-chats/unread-count')]);
    const n = (b.count ?? b.unread ?? 0) + (w.count ?? w.unread ?? 0);
    const el = $('#tab-msg-badge');
    if (!el) return;
    el.textContent = n;
    el.classList.toggle('hidden', !n);
  } catch {}
}

// ---------- 路由 ----------
const routes = {
  '#/login': vLogin, '#/register': vRegister,
  '#/browse': vBrowse, '#/book': vBook, '#/sell': vSell,
  '#/wishpost': vWishpost, '#/wishlist': vWishlist, '#/wish': vWishDetail,
  '#/inbox': vInbox, '#/chat': vChat,
  '#/notifications': vNotifications,
  '#/invite': vInvite, '#/me': vMe, '#/user': vUser,
  '#/feedback': vFeedback, '#/guide': vGuide,
};
function go(hash) { location.hash = hash; }
// 关键：目标 hash 与当前相同时 location.hash 赋值不会触发 hashchange，
// 必须手动 render —— 登录成功后曾因此卡在登录页（URL 已变视图未变）
function navTo(hash) { if (location.hash === hash) render(); else location.hash = hash; }

// ---------- 想买书 / 想卖书 双模式（形态参考乐乐代跑底部模式切换条） ----------
// 想买书：[书市][求购] + 消息/邀请/我的；想卖书：[心愿单][卖书] + 消息/邀请/我的。
// 消息/邀请/我的两模式共用，聊天合并展示；选择本地记住，切换回到该模式首 Tab
let bookMode = localStorage.getItem('whu_mode') === 'sell' ? 'sell' : 'buy';
function setMode(m) {
  if (bookMode === m) return;
  bookMode = m;
  localStorage.setItem('whu_mode', m);
  renderTabbar();
  // 不经过 render 的场景（详情页等）也要同步切换条高亮
  $('#mode-buy').classList.toggle('on', m === 'buy');
  $('#mode-sell').classList.toggle('on', m === 'sell');
  // 停在另一模式专属 Tab 时跳到当前模式首 Tab；详情页等页面保持原地
  const modeTabHashes = ['#/browse', '#/wishpost', '#/wishlist', '#/sell'];
  if (modeTabHashes.includes((location.hash || '').split('?')[0])) {
    navTo(bookMode === 'buy' ? '#/browse' : '#/wishlist');
  }
}
const TAB_SVGS = {
  browse: '<svg viewBox="0 0 24 24"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  wishpost: '<svg viewBox="0 0 24 24"><path d="M12 20h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16.5 3.5l4 4L7 21l-4 1 1-4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  wishlist: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 8h6M9 12h6M9 16h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  sell: '<svg viewBox="0 0 24 24"><path d="M12 3v11M7.5 7.5L12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  inbox: '<svg viewBox="0 0 24 24"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-4 4v-4H6a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  invite: '<svg viewBox="0 0 24 24"><rect x="4" y="9" width="16" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 11l8 5 8-5M12 3v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  me: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 20a7 7 0 0 1 14 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};
function renderTabbar() {
  const tabs = bookMode === 'buy'
    ? [['#/browse', '书市'], ['#/wishpost', '求购']]
    : [['#/wishlist', '心愿单'], ['#/sell', '卖书']];
  const shared = [['#/inbox', '消息', true], ['#/invite', '邀请'], ['#/me', '我的']];
  $('#tabbar').innerHTML = [...tabs, ...shared].map(([r, label, withBadge]) =>
    `<a data-r="${r}" onclick="go('${r}')">${TAB_SVGS[r.slice(2)] || ''}<span>${label}</span>${withBadge ? '<span id="tab-msg-badge" class="badge hidden"></span>' : ''}</a>`
  ).join('');
}

// 摆放示例灯箱：展示标准摆拍/书单示例照片，点击任意处关闭
function showExample(ev, img) {
  ev?.stopPropagation();
  const src = img || '/example-books.jpg';
  const tip = src.includes('wish')
    ? '像这样把书单拍清楚 ↑ 已划掉的书 AI 会自动排除，只认需要买的书'
    : '像这样把书竖直排开、书名朝外拍一张 ↑ 点击任意处关闭';
  const ov = document.createElement('div');
  ov.className = 'img-overlay';
  ov.innerHTML = `<div class="img-box"><img src="${src}" alt="摆放示例"><div class="sub" style="color:#dfe5e9;margin-top:10px">${tip}</div></div>`;
  ov.onclick = () => ov.remove();
  document.body.appendChild(ov);
}

function render() {
  // hash 可能带查询参数（如邀请链接 #/login?invite=XXX），路由匹配前剥掉
  let hash = (location.hash || '#/browse').split('?')[0];
  const logged = isLogin();
  // 未登录一律先到登录/注册页
  if (!logged && !hash.startsWith('#/login') && !hash.startsWith('#/register')) hash = '#/login';
  $('#topbar').classList.toggle('hidden', !logged);
  $('#bell').classList.toggle('hidden', !logged || hash.startsWith('#/notifications'));
  $('#tabbar').classList.toggle('hidden', !logged);
  $('#modewrap').classList.toggle('hidden', !logged);
  if (logged) {
    renderTabbar();
    $('#mode-buy').classList.toggle('on', bookMode === 'buy');
    $('#mode-sell').classList.toggle('on', bookMode === 'sell');
  }
  document.querySelectorAll('#tabbar a').forEach((a) => a.classList.toggle('on', hash.startsWith(a.dataset.r)));
  $('#view').className = '';
  const fn = routes[hash.split('/').slice(0, 2).join('/')] || (logged ? vBrowse : vLogin);
  Promise.resolve(fn(hash)).catch((e) => {
    $('#view').innerHTML = `<div class="empty"><div class="big">😵</div>${esc(e.message)}<br><br><span class="linkish" onclick="render()">重试</span></div>`;
  });
  window.scrollTo(0, 0);
  if (logged) { loadBell(); loadMsgBadge(); wsConnect(); }
}
window.addEventListener('hashchange', render);

// ---------- 登录 / 注册 ----------
// 登录/注册合一：先邮箱+验证码，未注册就地补资料（验证码不白发）
let loginStep = 1;
let loginEmail = '';
let loginPending = '';
let loginInvite = '';

function vLogin() {
  // 邀请链接携带：#/?invite=CODE 或 #/login?invite=CODE
  const mq = location.hash.match(/[?&]invite=([A-Za-z0-9]+)/);
  if (mq) loginInvite = mq[1].toUpperCase();

  const step1 = `
    <div class="field"><label>邮箱（武大邮箱或其他邮箱均可）</label><input id="lg-email" type="email" placeholder="邮箱"></div>
    <div class="field"><label>验证码</label><div class="row"><input id="lg-code" class="grow" placeholder="6 位验证码"><button class="btn small" id="lg-send">获取验证码</button></div></div>
    <button class="btn" id="lg-btn">登录 / 注册</button>`;
  const step2 = `
    <div class="field"><label>昵称（已自动生成，可更改）</label><input id="lg-nick" maxlength="20" placeholder="给自己起个昵称"></div>
    ${loginInvite ? `<div class="field"><label>邀请码（来自好友链接，选填）</label><input id="lg-invite" value="${esc(loginInvite)}" style="background:#e6f5ee"></div>` : ''}
    <div class="field"><label>注册协议</label><div class="sub" style="max-height:96px;overflow:auto;line-height:1.6">欢迎使用 WHU二手书市（"本平台"）。本平台仅为在校学生提供二手书信息展示与沟通渠道，不参与交易、不碰钱。请如实填写注册信息；严禁发布虚假违法信息；线下交易请当面验书、当面付款。提交注册即视为同意以上内容。</div>
    <div class="agree-row"><input type="checkbox" id="lg-agree" checked><label for="lg-agree">我已阅读并同意以上协议</label></div></div>
    <button class="btn" id="lg-finish">完成注册</button>`;

  $('#view').innerHTML = `
    <div style="background:radial-gradient(circle at 85% -20%,rgba(255,255,255,.15) 0 70px,transparent 71px),linear-gradient(135deg,#0d7a54,#12a06f);color:#fff;border-radius:0 0 26px 26px;margin:-12px -14px 18px;padding:42px 26px 60px">
      <div style="font-size:30px;font-weight:800;letter-spacing:1px;display:flex;align-items:center;gap:12px">
        <img src="/appicon.png" style="width:40px;height:40px">WHU二手书市</div>
      <div style="font-size:13px;opacity:.92;margin-top:8px">教材课本 · 让好书继续流转</div>
    </div>
    <div class="card overlap">
      <div id="lg-step">${loginStep === 2 ? step2 : step1}</div>
      <div class="center muted" style="margin-top:12px">售卖闲置教材，请当面验书、当面付款</div>
    </div>`;

  // 第二步没有验证码行和登录按钮，绑定必须按步骤区分（否则 null.onclick 报错中断）
  if (loginStep === 1) bindCode('#lg-email', '#lg-send', 'login');

  // 昵称自动生成：意象词 + 书事词 + 2 位尾数（如「拾光煮书37」），好记又不易撞
  if (loginStep === 2) {
    const nick = $('#lg-nick');
    if (nick && !nick.value) {
      const A = ['晚风', '清梦', '拾光', '折月', '衔星', '青野', '白鹭', '春屿', '木南', '观夏', '闻笛', '眠鸥'];
      const B = ['翻书', '煮书', '书虫', '藏书', '书旅', '品书', '书灯', '书檐'];
      nick.value = A[Math.floor(Math.random() * A.length)] + B[Math.floor(Math.random() * B.length)] + String(Math.floor(100 + Math.random() * 900));
    }
  }

  // 第一步：验证码校验 → 已注册登录 / 未注册进入第二步
  const lgBtn = $('#lg-btn');
  if (lgBtn) lgBtn.onclick = async () => {
    loginEmail = ($('#lg-email') || {}).value?.trim() || loginEmail;
    const code = ($('#lg-code') || {}).value?.trim() || '';
    if (!loginEmail) return toast('请填写邮箱');
    if (!code) return toast('请填写验证码');
    const btn = $('#lg-btn'); btn.disabled = true;
    try {
      const d = await POST('/auth/login-or-register', { email: loginEmail, code });
      if (d.registered) {
        setToken(d.token); window._myId = d.user.id;
        toast('欢迎回来～'); navTo('#/browse');
      } else {
        loginPending = d.pending;
        loginStep = 2;
        vLogin();
        toast('还差最后一步：确认昵称就完成注册啦');
      }
    } catch (e) { toast(e.message); }
    btn.disabled = false;
  };

  // 第二步：完成注册（昵称已自动生成，仅需确认；性别/年级不再收集）
  const finish = $('#lg-finish');
  if (finish) finish.onclick = async () => {
    const nickname = ($('#lg-nick') || {}).value?.trim() || '';
    if (!nickname) return toast('请填写昵称');
    if (!$('#lg-agree').checked) return toast('请勾选同意注册协议');
    finish.disabled = true;
    try {
      const d = await POST('/auth/complete-register', {
        pending: loginPending, nickname, invite: loginInvite,
      });
      setToken(d.token); window._myId = d.user.id;
      navTo('#/guide'); // 注册成功先进引导页（登录不走这里）
    } catch (e) { finish.disabled = false; toast(e.message); }
  };
}

// ---------- 新手引导（注册完成进入一次） ----------
function vGuide() {
  $('#view').className = '';
  $('#view').innerHTML = `
    <div class="gd-hero gd-rise">
      <div class="gd-badge">🎉</div>
      <div class="gd-title">欢迎加入 WHU二手书市</div>
      <div class="gd-sub">30 秒看懂怎么玩<br>底部「想买书 / 想卖书」两个模式随时切换</div>
    </div>
    <div class="gd-mode gd-rise" style="animation-delay:.12s">
      <div class="gd-mode-head">🛒 想买书<span>切到此模式后 ↓</span></div>
      <div class="gd-item"><b>书市</b><span>淘同学出的闲置书，模糊搜索很聪明（"线代"也能搜到"线性代数"）</span></div>
      <div class="gd-item"><b>求购</b><span>发布心愿等书来找你：可拍书单让 AI 识别，划掉的会自动排除</span></div>
    </div>
    <div class="gd-mode gd-rise" style="animation-delay:.24s">
      <div class="gd-mode-head">📚 想卖书<span>切到此模式后 ↓</span></div>
      <div class="gd-item"><b>卖书</b><span>拍照上架，一摞书一张照 AI 批量识别；上架满 1 年自动下架，可重新上架</span></div>
      <div class="gd-item"><b>心愿单</b><span>看看大家在找什么书——有货就联系 TA，生意自己送上门</span></div>
    </div>
    <div class="gd-tip gd-rise" style="animation-delay:.36s">💬 所有买卖沟通都在「消息」里；有人联系你会邮件提醒<br>🤝 平台不碰钱：见面当面验书、当面付款</div>
    <button class="btn gd-go gd-rise" style="animation-delay:.48s" id="guide-go">开始逛书市 →</button>
    <div class="center muted gd-rise" style="animation-delay:.56s;font-size:11.5px;margin-top:10px">「消息 / 邀请 / 我的」两个模式通用</div>`;
  $('#guide-go').onclick = () => navTo('#/browse');
}

function vRegister() { return vLogin(); // 注册已收敛进登录页

  let schoolId = 0;
  $('#view').innerHTML = `
    <div class="card">
      <div class="field"><label>1 · 邮箱</label><input id="rg-email" type="email" placeholder="邮箱"></div>
      <div class="field"><label>验证码</label><div class="row"><input id="rg-code" class="grow" placeholder="6 位验证码"><button class="btn small" id="rg-send">获取验证码</button></div></div>
      <div class="field"><label>2 · 昵称（1-20 字）</label><input id="rg-nick" placeholder="昵称"></div>
      <div class="field"><label>3 · 学校</label><select id="rg-school"><option value="">加载中…</option></select></div>
      <div class="field"><label>4 · 性别</label><div class="chips" id="rg-gender">
        <button class="chip" data-v="female">女</button><button class="chip" data-v="male">男</button>
      </div></div>
      <div class="field"><label>注册协议</label><div class="sub" style="max-height:110px;overflow:auto;line-height:1.6">欢迎使用 WHU二手书市（"本平台"）。本平台仅为在校学生提供二手书信息展示与沟通渠道，不参与交易、不碰钱。请如实填写注册信息；严禁发布虚假违法信息；线下交易请当面验书、当面付款，注意人身财物安全。提交注册即视为同意以上全部内容。</div>
      <div class="row" style="margin-top:6px"><input type="checkbox" id="rg-agree"><label for="rg-agree" style="margin:0">我已阅读并同意以上协议</label></div></div>
      <button class="btn" id="rg-btn">注 册</button>
      <div class="center muted" style="margin-top:12px">已有账号？<span class="linkish" onclick="go('#/login')">去登录</span></div>
    </div>`;
  bindCode('#rg-email', '#rg-send', 'register');
  let gender = '';
  document.querySelectorAll('#rg-gender .chip').forEach((c) => c.onclick = () => {
    gender = c.dataset.v;
    document.querySelectorAll('#rg-gender .chip').forEach((x) => x.classList.toggle('on', x === c));
  });
  GET('/schools').then((d) => {
    const sel = $('#rg-school');
    sel.innerHTML = d.list.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    schoolId = d.list[0]?.id || 0;
    sel.onchange = () => schoolId = +sel.value;
  });
  $('#rg-btn').onclick = async () => {
    if (!$('#rg-agree').checked) return toast('请先勾选同意注册协议');
    try {
      const d = await POST('/auth/register', {
        email: $('#rg-email').value.trim(), code: $('#rg-code').value.trim(),
        nickname: $('#rg-nick').value.trim(), school_id: schoolId, gender,
      });
      setToken(d.token); window._myId = d.user.id; toast('注册成功'); navTo('#/browse');
    } catch (e) { toast(e.message); }
  };
}

// 验证码发送（登录/注册共用）
function bindCode(emailSel, btnSel, purpose) {
  $(btnSel).onclick = async () => {
    const email = $(emailSel).value.trim();
    if (!email) return toast('请填写邮箱');
    const btn = $(btnSel);
    btn.disabled = true; btn.textContent = '发送中…';
    try {
      const d = await POST('/auth/send-code', { email, purpose });
      toast(d.msg || '验证码已发送，请查收邮件');
      let sec = 60;
      btn.textContent = '已发送 60s';
      const h = setInterval(() => { sec--; btn.textContent = '已发送 ' + sec + 's'; if (sec <= 0) { clearInterval(h); btn.disabled = false; btn.textContent = '获取验证码'; } }, 1000);
    } catch (e) { btn.disabled = false; btn.textContent = '获取验证码'; toast(e.message); }
  };
}

// ---------- 书市 ----------
let browseQ = '', browseSort = 'latest', browsePage = 1;
function vBrowse() {
  $('#view').innerHTML = `
    <div class="card search-card">
      <div class="search-row">
        <svg class="search-ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <input id="bq" placeholder="搜书名 / 课程 / 说明" value="${esc(browseQ)}">
        <button id="bq-go">搜索</button>
      </div>
      <div class="chips" style="margin-top:12px">
        <button class="chip ${browseSort === 'latest' ? 'on' : ''}" data-s="latest">最新发布</button>
        <button class="chip ${browseSort === 'price_asc' ? 'on' : ''}" data-s="price_asc">价格 低→高</button>
        <button class="chip ${browseSort === 'price_desc' ? 'on' : ''}" data-s="price_desc">价格 高→低</button>
      </div>
    </div>
    <div id="blist"><div class="empty">加载中…</div></div>`;
  $('#bq-go').onclick = () => { browseQ = $('#bq').value.trim(); loadBrowse(); };
  $('#bq').onkeydown = (e) => { if (e.key === 'Enter') { browseQ = $('#bq').value.trim(); loadBrowse(); } };
  document.querySelectorAll('.chips .chip').forEach((c) => c.onclick = () => { browseSort = c.dataset.s; vBrowse(); });
  loadBrowse();
}
async function loadBrowse(append) {
  const box = $('#blist');
  if (!append) { browsePage = 1; box.innerHTML = '<div class="empty">加载中…</div>'; }
  try {
    const d = await GET(`/books?q=${encodeURIComponent(browseQ)}&sort=${browseSort}&page=${browsePage}`);
    $('#more-browse')?.remove();
    if (!d.list.length && !append) {
      box.innerHTML = '<div class="empty"><div class="big">📚</div>暂时没有在售的书<br>去「卖书」发布第一本吧</div>';
      return;
    }
    if (!append) box.innerHTML = '';
    const frag = document.createElement('div');
    frag.innerHTML = d.list.map(bookCardHtml).join('');
    while (frag.firstChild) box.appendChild(frag.firstChild);
    if (d.has_more) {
      const more = document.createElement('button');
      more.id = 'more-browse';
      more.className = 'btn ghost';
      more.style.cssText = 'margin:14px auto;display:block';
      more.textContent = '加载更多';
      more.onclick = () => { browsePage++; loadBrowse(true); };
      box.appendChild(more);
    }
    document.querySelectorAll('#blist .book-card').forEach((el) => el.onclick = () => go('#/book/' + el.dataset.id));
  } catch (e) { if (!append) box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
function bookCardHtml(b) {
  const price = b.price_cents > 0 ? `<div class="bc-price">${yuan(b.price_cents)}</div>`
    : `<div class="bc-price small">${esc(b.price_note || '价格面议')}</div>`;
  const cover = b.photo ? `<img class="cover" src="/files/books/${b.id}.jpg" onerror="this.style.visibility='hidden'">` : `<div class="cover">📖</div>`;
  return `<div class="book-card" data-id="${b.id}">
    ${cover}
    <div class="bc-body">
      <div class="bc-title">${esc(b.title)}</div>
      ${b.price_note && b.price_cents === 0 ? '' : ''}
      ${b.note ? `<div class="bc-note">${esc(b.note)}</div>` : ''}
      <div style="margin-top:3px">${b.is_mine ? '<span class="tag" style="background:var(--brand-soft);color:var(--brand)">📌 我的</span>' : ''}${b.cond_cn ? `<span class="tag">${esc(b.cond_cn)}</span>` : ''}${b.course ? `<span class="tag gray">📘 ${esc(b.course)}</span>` : ''}</div>
      <div class="bc-meta">👤 ${esc(b.seller?.nickname || '')} · ${esc(b.school || '')} · ${fmtTime(b.created_at)}</div>
    </div>
    ${price}
  </div>`;
}

// ---------- 书籍详情 ----------
async function vBook(hash) {
  const id = hash.split('/')[2];
  const d = await GET('/books/' + id);
  const b = d;
  const cover = b.photo ? `<div class="detail-cover"><img src="/files/books/${b.id}.jpg" onerror="this.parentNode.innerHTML='<div style=padding:60px>📖</div>'"></div>` : `<div class="detail-cover" style="height:200px">📖</div>`;
  const price = b.price_cents > 0 ? `<span class="d-price big">${yuan(b.price_cents)}</span>`
    : (b.price_note ? `<span class="d-note">${esc(b.price_note)}</span>` : '<span class="muted">价格面议</span>');
  $('#view').innerHTML = `
    ${cover}
    <div class="row" style="align-items:flex-start;margin:12px 2px 6px">
      <div class="grow"><div class="d-title" style="margin:0">${esc(b.title)}</div></div>
      <div>${price}</div>
    </div>
    <div style="margin:0 2px 10px">
      ${b.status === 'on' ? '<span class="tag">在售</span>' : b.status === 'off' ? '<span class="tag gray">已下架</span>' : '<span class="tag gray">已售出</span>'}
      ${b.cond_cn ? `<span class="tag">${esc(b.cond_cn)}</span>` : ''}
      ${b.course ? `<span class="tag gray">📘 ${esc(b.course)}</span>` : ''}
      ${b.location ? `<span class="tag gray">📍 ${esc(b.location)}</span>` : ''}
    </div>
    ${b.price_note && b.price_cents === 0 ? `<div class="card"><div class="sub" style="margin-bottom:4px">价格描述</div><div class="d-note">${esc(b.price_note)}</div></div>` : ''}
    ${b.note ? `<div class="card"><div class="sub" style="margin-bottom:4px">补充说明</div>${esc(b.note)}</div>` : ''}
    <div class="card seller-card">
      <div class="avatar">${esc((b.seller?.nickname || '友')[0])}</div>
      <div class="grow">
        <div style="font-weight:700">${esc(b.seller?.nickname || '')}</div>
        <div class="sub">在售 ${b.seller?.books_on ?? 0} 本 · 注册 ${fmtTime(b.seller?.created_at)}</div>
      </div>
      <button class="btn small ghost" onclick="go('#/user/${b.seller?.id}')">看主页</button>
    </div>
    <div class="card tips-card">
      <div class="sub">平台仅提供信息展示与联系，不参与交易：请先聊好价格与地点，<b>见面当面验书、满意再付款</b>。</div>
    </div>
    ${d.is_seller
      ? `<button class="btn ghost" onclick="go('#/sell')">管理我的书（卖书页）</button>`
      : (b.my_thread
        ? `<button class="btn" onclick="go('#/chat/${b.my_thread.chat_id}')">继续聊天</button>`
        : ((b.status === 'on' || b.status === 'off') ? `<button class="btn" id="contact-btn">💬 联系卖家</button>` : ''))}
    ${d.is_seller ? '' : `<button class="btn danger" style="margin-top:10px" id="report-btn">🚩 举报该书籍（虚假信息等提交平台审核）</button>`}`;
  const cb = $('#contact-btn');
  if (cb) cb.onclick = async () => {
    cb.disabled = true;
    try {
      const r = await POST(`/books/${id}/contact`, {});
      toast('已联系卖家，去消息里聊吧');
      go('#/chat/' + r.chat_id);
    } catch (e) { cb.disabled = false; toast(e.message); }
  };
  const rb = $('#report-btn');
  if (rb) rb.onclick = () => {
    const reason = prompt('举报原因（5-200 字，虚假信息/盗版/非本校人员等）：');
    if (reason === null) return;
    if (reason.trim().length < 5) return toast('请填写至少 5 个字的举报原因');
    POST(`/books/${id}/report`, { reason: reason.trim() }).then(() => toast('举报已提交，平台将审核处理')).catch((e) => toast(e.message));
  };
}

// ---------- 卖书 / 我的书 ----------
let sellMode = 'batch';
let sellImg = '';           // 压缩后的合照 dataUrl
let batchTitles = [];
let coverImg = '';          // 单本封面
let editCoverBook = 0;      // 换封面的书 id

function vSell() {
  const batch = sellMode === 'batch';
  $('#view').innerHTML = `
    <div class="card">
      <div style="font-size:16px;font-weight:800;margin-bottom:10px">发布闲置书</div>
      <div class="chips" style="margin-bottom:12px">
        <button class="chip ${batch ? 'on' : ''}" id="m-batch">📚 批量发书</button>
        <button class="chip ${!batch ? 'on' : ''}" id="m-single">📖 单本发布</button>
      </div>
      <div id="sell-body"></div>
    </div>
    <h2 class="sec" id="mine-count">我的书</h2>
    <div id="mine-list"><div class="empty">加载中…</div></div>`;
  $('#m-batch').onclick = () => { sellMode = 'batch'; vSell(); };
  $('#m-single').onclick = () => { sellMode = 'single'; vSell(); };
  $('#sell-body').innerHTML = batch ? batchFormHtml() : singleFormHtml();
  if (batch) bindBatch(); else bindSingle();
  loadMine();
}

function batchFormHtml() {
  return `
    <div class="muted" style="margin-bottom:10px">把要卖的书放一起拍一张照，AI 帮你认出书名，核对后一次全部上架；价格可以写一句描述（如：左边10r/本，右边20r/本）。</div>
    <div class="row" style="align-items:flex-start">
      <div class="up-box" id="up-box" onclick="$('#sell-file').click()">${sellImg ? `<img src="${sellImg}">` : '📷<br>拍合照'}</div>
      <div class="grow">
        <div class="sub" style="line-height:1.6;margin-bottom:8px">把要卖的书放一起拍一张，尽量让每个书名都拍清晰。这张照片会同时作为每本书的封面，AI 识别约需 20 秒。不知道怎么摆？看<span class="linkish" onclick="showExample(event)">示例图片</span>。</div>
        <button class="btn small ${sellImg ? '' : 'ghost'}" id="ai-btn">🤖 AI 识别书名</button>
      </div>
    </div>
    <input type="file" id="sell-file" accept="image/*" class="hidden">
    <div class="field" style="margin-top:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <label style="margin-bottom:0">书名（识别后请核对，可增删改）</label>
        <button class="chip small" id="add-one" type="button">+ 添加一本</button>
      </div>
      <div id="titles" style="margin-top:9px"></div>
    </div>
    <div class="field"><label>交易地点（必填，所有书共用）</label><input id="bt-loc" placeholder="当面交书的地点"></div>
    <div class="field"><label>价格描述（必填，1-60 字，所有书共用）</label><input id="bt-price" placeholder="例如：左边10r/本，右边20r/本"></div>
    <div class="muted" style="font-size:11.5px;line-height:1.6;margin:2px 2px 8px">💡 有买家第一次联系你时，会发送<b>邮件通知</b>提醒你，重要消息不错过。<br>⏳ 书籍上架满 1 年会自动下架，需要可重新上架。</div>
    <button class="btn" id="bt-go"></button>`;
}
function renderTitles() {
  $('#titles').innerHTML = batchTitles.length
    ? batchTitles.map((t, i) => `<div class="row" style="margin-bottom:8px"><input class="grow bt-title" data-i="${i}" value="${esc(t)}" placeholder="书名（1-40 字）"><button class="btn small danger" onclick="batchTitles.splice(${i},1);renderTitles()">✕</button></div>`).join('')
    : '<div class="muted">还没添加书：选好合照后点「AI 识别书名」自动认出，也可以「+ 添加一本」手动填。</div>';
  const n = batchTitles.filter((t) => t.trim()).length;
  $('#bt-go').textContent = `${n} 本全部发布`;
}
function bindBatch() {
  renderTitles();
  // 输入事件挂 #titles 容器上（事件委托）：renderTitles 每次重建行 DOM，
  // 若逐行绑 oninput，「+ 添加一本」/AI 识别出来的新行打字不会同步进数据，
  // 表现为一直显示 0 本、点发布被"请至少填写一个书名"挡住
  $('#titles').addEventListener('input', (e) => {
    const inp = e.target.closest('.bt-title');
    if (!inp) return;
    batchTitles[+inp.dataset.i] = inp.value;
    const n = batchTitles.filter((t) => t.trim()).length;
    $('#bt-go').textContent = `${n} 本全部发布`;
  });
  $('#add-one').onclick = () => { batchTitles.push(''); renderTitles(); const inputs = document.querySelectorAll('.bt-title'); inputs[inputs.length - 1]?.focus(); };
  $('#sell-file').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      sellImg = await compressImage(f, 1600, 500);
      $('#up-box').innerHTML = `<img src="${sellImg}">`;
      $('#ai-btn').classList.remove('ghost');
      toast('已选合照，点「AI 识别书名」开始识别');
    } catch (err) { toast(err.message); }
  };
  $('#ai-btn').onclick = async () => {
    if (!sellImg) return toast('请先选合照');
    const go = async () => {
      $('#ai-btn').disabled = true; $('#ai-btn').textContent = '图片识别处理中，约需 20 秒…';
      try {
        const fd = new FormData();
        fd.append('file', dataUrlToBlob(sellImg), 'photo.jpg');
        const d = await api('POST', '/books/batch/analyze', fd, true);
        batchTitles = d.titles.slice();
        renderTitles();
        toast(`识别出 ${d.titles.length} 本，请核对增删改`);
      } catch (e) { toast(e.message); }
      $('#ai-btn').disabled = false; $('#ai-btn').textContent = '🤖 AI 识别书名';
    };
    if (batchTitles.some((t) => t.trim())) {
      if (confirm('重新识别会覆盖你现在填写的书名列表，继续？')) go();
    } else go();
  };
  $('#bt-go').onclick = async () => {
    const titles = batchTitles.map((t) => t.trim()).filter(Boolean);
    if (!titles.length) return toast('请至少填写一个书名');
    if (titles.length > 20) return toast('一次最多发布 20 本');
    const loc = $('#bt-loc').value.trim(), price = $('#bt-price').value.trim();
    if (!sellImg) return toast('请先选合照（会作为每本书的封面）');
    if (loc.length < 2) return toast('请填写交易地点（2-30 字）');
    if (!price) return toast('请填写价格描述，例如：左边10r/本，右边20r/本');
    if (!confirm(`将一次发布 ${titles.length} 本独立的书：共用合照封面、地点「${loc}」、价格描述「${price}」。有买家第一次联系你时会邮件通知你。确认发布？`)) return;
    const btn = $('#bt-go'); btn.disabled = true; btn.textContent = '发布中…';
    try {
      const fd = new FormData();
      fd.append('titles', JSON.stringify(titles));
      fd.append('location', loc);
      fd.append('price_note', price);
      fd.append('file', dataUrlToBlob(sellImg), 'cover.jpg');
      const d = await api('POST', '/books/batch', fd, true);
      toast(`已发布 ${d.count} 本书！`);
      batchTitles = []; sellImg = '';
      vSell();
    } catch (e) { btn.disabled = false; btn.textContent = `${titles.length} 本全部发布`; toast(e.message); }
  };
}

function singleFormHtml() {
  return `
    <div class="field"><label>书名（必填，1-40 字）</label><input id="s-title" placeholder="例如：高等数学（第七版）下册 同济版"></div>
    <div class="field"><label>新旧程度（选填）</label><div class="chips" id="s-cond">
      <button class="chip" data-v="">不选</button><button class="chip" data-v="1">全新未使用</button><button class="chip" data-v="2">几乎全新</button>
      <button class="chip" data-v="3">有笔记划线</button><button class="chip" data-v="4">使用痕迹较多</button></div></div>
    <div class="field"><label>期望价格（必填，0.01-999.99 元）</label><input id="s-price" placeholder="如 15"></div>
    <div class="field"><label>交易地点（必填）</label><input id="s-loc" placeholder="当面交书的地点"></div>
    <div class="field"><label>选填项（课程 · 说明 · 封面照片）<button class="chip small" style="float:right" id="s-extra-toggle">${coverImg ? '收起选填项 ▲' : '展开选填项 ▼'}</button></label><div id="s-extra" style="display:${coverImg ? 'block' : 'none'}">
      <input id="s-course" placeholder="对应课程（选填），例如：大学英语" style="width:100%;padding:11px 14px;border:1.5px solid var(--line);border-radius:12px;margin-bottom:10px">
      <textarea id="s-note" rows="2" placeholder="补充说明（选填，≤300 字），例如：重点笔记齐全，无缺页" style="width:100%;padding:11px 14px;border:1.5px solid var(--line);border-radius:12px;margin-bottom:10px"></textarea>
      <div class="row"><div class="up-box" id="s-upbox" onclick="$('#s-file').click()">${coverImg ? `<img src="${coverImg}">` : '📷<br>加封面'}</div>
      <div class="grow sub">拍清书名与封面更醒目</div></div>
      <input type="file" id="s-file" accept="image/*" class="hidden">
    </div></div>
    <div class="muted" style="font-size:11.5px;line-height:1.6;margin:2px 2px 8px">💡 有买家第一次联系你时，会发送<b>邮件通知</b>提醒你，重要消息不错过。<br>⏳ 书籍上架满 1 年会自动下架，需要可重新上架。</div>
    <button class="btn" id="s-go">发布到书市</button>`;
}
let sellCond = '';
function bindSingle() {
  sellCond = '';
  document.querySelectorAll('#s-cond .chip').forEach((c) => c.onclick = () => {
    sellCond = c.dataset.v;
    document.querySelectorAll('#s-cond .chip').forEach((x) => x.classList.toggle('on', x === c));
  });
  $('#s-extra-toggle').onclick = () => {
    const box = $('#s-extra');
    const open = box.style.display !== 'none';
    box.style.display = open ? 'none' : 'block';
    $('#s-extra-toggle').textContent = open ? '展开选填项 ▼' : '收起选填项 ▲';
  };
  $('#s-file').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      coverImg = await compressImage(f, 800, 200);
      $('#s-upbox').innerHTML = `<img src="${coverImg}">`;
      $('#s-extra-toggle').textContent = '收起选填项 ▲';
    } catch (err) { toast(err.message); }
  };
  $('#s-go').onclick = async () => {
    const title = $('#s-title').value.trim();
    const price = Math.round(parseFloat($('#s-price').value) * 100);
    const loc = $('#s-loc').value.trim();
    if (!title) return toast('请填写书名');
    if (!Number.isFinite(price) || price < 1 || price > 99999) return toast('价格需在 0.01-999.99 元之间');
    if (loc.length < 2) return toast('请填写交易地点（2-30 字）');
    if (!confirm(`《${title}》定价 ${(price / 100).toFixed(2)} 元。平台仅提供信息展示，请与买家当面验书、当面付款。有买家第一次联系你时会邮件通知你。确认发布？`)) return;
    const btn = $('#s-go'); btn.disabled = true;
    try {
      const d = await POST('/books', {
        title, course: $('#s-course').value.trim(), cond: sellCond ? +sellCond : undefined,
        price_cents: price, note: $('#s-note').value.trim(), location: loc,
      });
      if (coverImg) {
        const fd = new FormData();
        fd.append('file', dataUrlToBlob(coverImg), 'cover.jpg');
        await api('POST', '/books/' + d.id + '/photo', fd, true);
      }
      toast('发布成功！');
      coverImg = '';
      vSell();
    } catch (e) { btn.disabled = false; toast(e.message); }
  };
}

async function loadMine() {
  try {
    const d = await GET('/books/mine');
    $('#mine-count').textContent = `我的书（${d.list.length}）`;
    if (!d.list.length) { $('#mine-list').innerHTML = '<div class="empty"><div class="big">📖</div>还没有发布书<br>在上面发布第一本吧</div>'; return; }
    $('#mine-list').innerHTML = d.list.map((b) => {
      const price = b.price_cents > 0 ? `<span class="bc-price">${yuan(b.price_cents)}</span>` : `<span class="bc-price small">${esc(b.price_note || '')}</span>`;
      const st = b.status === 'on' ? '<span class="tag">在售</span>' : '<span class="tag gray">已下架</span>';
      const btn = b.status === 'off'
        ? `<button class="btn small ghost" onclick="bookStatus(${b.id},'on')">重新上架</button><button class="btn small danger" onclick="bookStatus(${b.id},'sold')">标记已售出</button>`
        : (b.status === 'on' ? `<button class="btn small ghost" onclick="bookStatus(${b.id},'off')">暂时下架</button><button class="btn small danger" onclick="bookStatus(${b.id},'sold')">标记已售出</button>` : '');
      return `<div class="mine-item">
        <div class="book-card" onclick="go('#/book/${b.id}')">
          ${b.photo ? `<img class="cover" src="/files/books/${b.id}.jpg" onerror="this.style.visibility='hidden'">` : '<div class="cover">📖</div>'}
          <div class="bc-body"><div class="bc-title">${esc(b.title)}</div>
            <div style="margin-top:3px">${st}${b.unread_chats > 0 ? `<span class="tag red">💬 ${b.unread_chats} 未读</span>` : ''}</div>
            <div class="bc-meta">${b.price_note && b.price_cents === 0 ? esc(b.price_note) : ''}</div>
          </div>${price}</div>
        <div class="row mine-btns">
          ${btn}
          <button class="btn small ghost" onclick="changeCover(${b.id}, event)">换封面</button>
          <button class="btn small ghost" onclick="go('#/book/${b.id}')">详情</button>
        </div>
      </div>`;
    }).join('');
    document.querySelectorAll('[data-coverid]').forEach((el) => el.onclick = (e) => { e.stopPropagation(); changeCover(+el.dataset.coverid); });
  } catch (e) { $('#mine-list').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function bookStatus(id, st) {
  const sold = st === 'sold';
  if (sold && !confirm('标记后本书所有信息将从书市删除（已产生的会话仍可继续沟通）。确认已当面交接？')) return;
  try { await POST(`/books/${id}/status`, { status: st }); toast(sold ? '已标记售出' : '已更新'); loadMine(); }
  catch (e) { toast(e.message); }
}
function changeCover(id, ev) {
  ev?.stopPropagation();
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    if (!inp.files[0]) return;
    try {
      const img = await compressImage(inp.files[0], 800, 200);
      const fd = new FormData();
      fd.append('file', dataUrlToBlob(img), 'cover.jpg');
      await api('POST', `/books/${id}/photo`, fd, true);
      toast('封面已更新'); loadMine();
    } catch (e) { toast(e.message); }
  };
  inp.click();
}

// ---------- 心愿单（求购）：浏览 / 发布 / 详情 ----------
// 需求侧：无价格，多一个"可自提"标记；图片选填（可放学校书单截图，AI 会识别并排除已划掉的书）
let wishQ = '', wishSort = 'latest', wishPage = 1;
function vWishlist() {
  $('#view').innerHTML = `
    <div class="card search-card">
      <div class="search-row">
        <svg class="search-ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <input id="wq" placeholder="搜心愿书名 / 课程 / 说明" value="${esc(wishQ)}">
        <button id="wq-go">搜索</button>
      </div>
      <div class="chips" style="margin-top:12px">
        <button class="chip ${wishSort === 'latest' ? 'on' : ''}" data-s="latest">最新发布</button>
        <button class="chip ${wishSort === 'pickup' ? 'on' : ''}" data-s="pickup">🤝 可自提优先</button>
      </div>
    </div>
    <div id="wlist"><div class="empty">加载中…</div></div>`;
  $('#wq-go').onclick = () => { wishQ = $('#wq').value.trim(); loadWishlist(); };
  $('#wq').onkeydown = (e) => { if (e.key === 'Enter') { wishQ = $('#wq').value.trim(); loadWishlist(); } };
  document.querySelectorAll('.chips .chip').forEach((c) => c.onclick = () => { wishSort = c.dataset.s; vWishlist(); });
  loadWishlist();
}
async function loadWishlist(append) {
  const box = $('#wlist');
  if (!append) { wishPage = 1; box.innerHTML = '<div class="empty">加载中…</div>'; }
  try {
    const d = await GET(`/wishes?q=${encodeURIComponent(wishQ)}&sort=${wishSort}&page=${wishPage}`);
    $('#more-wish')?.remove();
    if (!d.list.length && !append) {
      box.innerHTML = '<div class="empty"><div class="big">🙏</div>还没有人发心愿<br>切到「想买书」发布第一条求购吧</div>';
      return;
    }
    if (!append) box.innerHTML = '';
    const frag = document.createElement('div');
    frag.innerHTML = d.list.map(wishCardHtml).join('');
    while (frag.firstChild) box.appendChild(frag.firstChild);
    if (d.has_more) {
      const more = document.createElement('button');
      more.id = 'more-wish';
      more.className = 'btn ghost';
      more.style.cssText = 'margin:14px auto;display:block';
      more.textContent = '加载更多';
      more.onclick = () => { wishPage++; loadWishlist(true); };
      box.appendChild(more);
    }
    document.querySelectorAll('#wlist .book-card').forEach((el) => el.onclick = () => go('#/wish/' + el.dataset.id));
  } catch (e) { if (!append) box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
function wishCardHtml(w) {
  const cover = w.photo ? `<img class="cover" src="/files/wishes/${w.id}.jpg" onerror="this.style.visibility='hidden'">` : `<div class="cover">🙏</div>`;
  const pickup = w.pickup_ok ? `<div class="bc-price small" style="color:var(--brand)">🤝 可自提</div>` : '';
  return `<div class="book-card" data-id="${w.id}">
    ${cover}
    <div class="bc-body">
      <div class="bc-title">${esc(w.title)}</div>
      ${w.note ? `<div class="bc-note">${esc(w.note)}</div>` : ''}
      <div style="margin-top:3px">${w.is_mine ? '<span class="tag" style="background:var(--brand-soft);color:var(--brand)">📌 我的</span>' : ''}${w.course ? `<span class="tag gray">📘 ${esc(w.course)}</span>` : ''}${w.location ? `<span class="tag gray">📍 ${esc(w.location)}</span>` : ''}</div>
      <div class="bc-meta">🙋 ${esc(w.buyer?.nickname || '')} · ${esc(w.school || '')} · ${fmtTime(w.created_at)}</div>
    </div>
    ${pickup}
  </div>`;
}

// ---------- 发心愿（求购页，想买书模式） ----------
let wishMode = 'batch';
let wishImg = '';           // 压缩后的书单/参考图 dataUrl（选填）
let wishTitles = [];
let editWishCover = 0;      // 换参考图的心愿 id

function vWishpost() {
  const batch = wishMode === 'batch';
  $('#view').innerHTML = `
    <div class="card">
      <div style="font-size:16px;font-weight:800;margin-bottom:10px">发布求购心愿</div>
      <div class="chips" style="margin-bottom:12px">
        <button class="chip ${batch ? 'on' : ''}" id="wm-batch">📋 批量发心愿</button>
        <button class="chip ${!batch ? 'on' : ''}" id="wm-single">📝 单条心愿</button>
      </div>
      <div id="wish-body"></div>
    </div>
    <h2 class="sec" id="mywish-count">我的心愿</h2>
    <div id="mywish-list"><div class="empty">加载中…</div></div>`;
  $('#wm-batch').onclick = () => { wishMode = 'batch'; vWishpost(); };
  $('#wm-single').onclick = () => { wishMode = 'single'; vWishpost(); };
  $('#wish-body').innerHTML = batch ? wishBatchHtml() : wishSingleHtml();
  if (batch) bindWishBatch(); else bindWishSingle();
  loadMyWishes();
}
function wishBatchHtml() {
  return `
    <div class="muted" style="margin-bottom:10px">把书单（教材征订单、Excel 截图都可以）拍一张照，AI 帮你认出需要买的书名（已划掉的书会自动排除），核对后一次全部发布心愿。</div>
    <div class="row" style="align-items:flex-start">
      <div class="up-box" id="wup-box" onclick="$('#wish-file').click()">${wishImg ? `<img src="${wishImg}">` : '📷<br>拍书单'}</div>
      <div class="grow">
        <div class="sub" style="line-height:1.6;margin-bottom:8px">图片选填：不传图也可以发心愿。传学校书单截图的话，AI 只认<b>需要买</b>的书（划掉的不算）。不知道怎么给？看<span class="linkish" onclick="showExample(event, '/example-wish.jpg')">示例图片</span>。</div>
        <button class="btn small ${wishImg ? '' : 'ghost'}" id="wai-btn">🤖 AI 识别书名</button>
      </div>
    </div>
    <input type="file" id="wish-file" accept="image/*" class="hidden">
    <div class="field" style="margin-top:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <label style="margin-bottom:0">书名（识别后请核对，可增删改）</label>
        <button class="chip small" id="wadd-one" type="button">+ 添加一本</button>
      </div>
      <div id="wtitles" style="margin-top:9px"></div>
    </div>
    <div class="field"><label>交易地点（选"可自提"可不填）</label><input id="wt-loc" placeholder="希望送到附近的话，填个参考地点"></div>
    <div class="field"><label>可自提</label><div class="chips" id="wt-pickup">
      <button class="chip" data-v="1">🤝 可以，我上门取</button><button class="chip" data-v="0">不方便，可沟通地点</button></div>
      <div class="muted" style="font-size:11px;line-height:1.5;margin:5px 0 1px">选"可自提"卖家不用跑腿，更容易等到这本书</div></div>
    <div class="muted" style="font-size:11.5px;line-height:1.6;margin:2px 2px 8px">💡 有卖家联系你的心愿时，会发送<b>邮件通知</b>提醒你，重要消息不错过。<br>⏳ 心愿有学期性：发布 2 个月后会自动下架，需要可在「求购」页重新上架。</div>
    <button class="btn" id="wt-go"></button>`;
}
function wishSingleHtml() {
  return `
    <div class="field"><label>书名（必填，1-40 字）</label><input id="ws-title" placeholder="例如：高等数学（第七版）下册 同济版"></div>
    <div class="field"><label>交易地点（选"可自提"可不填）</label><input id="ws-loc" placeholder="希望送到附近的话，填个参考地点"></div>
    <div class="field"><label>可自提</label><div class="chips" id="ws-pickup">
      <button class="chip" data-v="1">🤝 可以，我上门取</button><button class="chip" data-v="0">不方便，可沟通地点</button></div></div>
    <div class="field"><label>选填项（课程 · 补充说明 · 参考图）<button class="chip small" style="float:right" id="ws-extra-toggle">${wishImg ? '收起选填项 ▲' : '展开选填项 ▼'}</button></label>
      <div id="ws-extra" style="display:${wishImg ? 'block' : 'none'}">
      <input id="ws-course" placeholder="对应课程（选填），例如：高等数学 AB" style="width:100%;padding:11px 14px;border:1.5px solid var(--line);border-radius:12px;margin-bottom:10px">
      <textarea id="ws-note" rows="2" placeholder="补充说明（选填，≤300 字），例如：旧版就行，笔记多也没关系" style="width:100%;padding:11px 14px;border:1.5px solid var(--line);border-radius:12px;margin-bottom:10px"></textarea>
      <div class="row"><div class="up-box" id="ws-upbox" onclick="$('#ws-file').click()">${wishImg ? `<img src="${wishImg}">` : '📷<br>加图片'}</div>
      <div class="grow sub">选填；放书单截图方便卖家对照</div></div>
      <input type="file" id="ws-file" accept="image/*" class="hidden">
    </div></div>
    <div class="muted" style="font-size:11.5px;line-height:1.6;margin:2px 2px 8px">💡 有卖家联系你的心愿时，会发送<b>邮件通知</b>提醒你，重要消息不错过。<br>⏳ 心愿有学期性：发布 2 个月后会自动下架，需要可在「求购」页重新上架。</div>
    <button class="btn" id="ws-go">发布心愿</button>`;
}
let wishPickup = 1; // 0/1，可自提（默认可以上门取，更容易等到这本书）
function bindWishChips(sel) {
  document.querySelectorAll(`${sel} .chip`).forEach((c) => c.onclick = () => {
    wishPickup = +c.dataset.v;
    document.querySelectorAll(`${sel} .chip`).forEach((x) => x.classList.toggle('on', x === c));
  });
  document.querySelectorAll(`${sel} .chip`).forEach((c) => c.classList.toggle('on', +c.dataset.v === wishPickup));
}
function renderWishTitles() {
  $('#wtitles').innerHTML = wishTitles.length
    ? wishTitles.map((t, i) => `<div class="row" style="margin-bottom:8px"><input class="grow wt-title" data-i="${i}" value="${esc(t)}" placeholder="书名（1-40 字）"><button class="btn small danger" onclick="wishTitles.splice(${i},1);renderWishTitles()">✕</button></div>`).join('')
    : '<div class="muted">还没添加书：选好书单照片后点「AI 识别书名」自动认出，也可以「+ 添加一本」手动填。</div>';
  const n = wishTitles.filter((t) => t.trim()).length;
  $('#wt-go').textContent = `${n} 条全部发布`;
}
function bindWishBatch() {
  renderWishTitles();
  bindWishChips('#wt-pickup');
  // 输入事件挂容器（事件委托）：行 DOM 会随增删重建，逐行绑定会丢（书市那边踩过的坑）
  $('#wtitles').addEventListener('input', (e) => {
    const inp = e.target.closest('.wt-title');
    if (!inp) return;
    wishTitles[+inp.dataset.i] = inp.value;
    const n = wishTitles.filter((t) => t.trim()).length;
    $('#wt-go').textContent = `${n} 条全部发布`;
  });
  $('#wadd-one').onclick = () => { wishTitles.push(''); renderWishTitles(); const inputs = document.querySelectorAll('.wt-title'); inputs[inputs.length - 1]?.focus(); };
  $('#wish-file').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      wishImg = await compressImage(f, 1600, 500);
      $('#wup-box').innerHTML = `<img src="${wishImg}">`;
      $('#wai-btn').classList.remove('ghost');
      toast('已选书单图片，点「AI 识别书名」开始识别');
    } catch (err) { toast(err.message); }
  };
  $('#wai-btn').onclick = async () => {
    if (!wishImg) return toast('请先选书单照片');
    const go2 = async () => {
      $('#wai-btn').disabled = true; $('#wai-btn').textContent = '图片识别处理中，约需 20 秒…';
      try {
        const fd = new FormData();
        fd.append('file', dataUrlToBlob(wishImg), 'photo.jpg');
        const d = await api('POST', '/wishes/batch/analyze', fd, true);
        wishTitles = d.titles.slice();
        renderWishTitles();
        toast(`识别出 ${d.titles.length} 本要买的书，请核对增删改`);
      } catch (e) { toast(e.message); }
      $('#wai-btn').disabled = false; $('#wai-btn').textContent = '🤖 AI 识别书名';
    };
    if (wishTitles.some((t) => t.trim())) {
      if (confirm('重新识别会覆盖你现在填写的书名列表，继续？')) go2();
    } else go2();
  };
  $('#wt-go').onclick = async () => {
    const titles = wishTitles.map((t) => t.trim()).filter(Boolean);
    if (!titles.length) return toast('请至少填写一个书名');
    if (titles.length > 20) return toast('一次最多发布 20 条心愿');
    const loc = $('#wt-loc').value.trim();
    if (loc.length > 30) return toast('地点最多 30 字');
    if (!wishPickup && loc.length < 2) return toast('请填写交易地点（2-30 字；选"可自提"时可以不填）');
    if (!confirm(`将一次发布 ${titles.length} 条求购心愿：共用地点「${loc || '可自提，无需固定地点'}」。有卖家联系你时会邮件通知你。确认发布？`)) return;
    const btn = $('#wt-go'); btn.disabled = true; btn.textContent = '发布中…';
    try {
      const fd = new FormData();
      fd.append('titles', JSON.stringify(titles));
      fd.append('location', loc);
      fd.append('pickup_ok', wishPickup ? '1' : '0');
      if (wishImg) fd.append('file', dataUrlToBlob(wishImg), 'wish.jpg');
      const d = await api('POST', '/wishes/batch', fd, true);
      toast(`已发布 ${d.count} 条心愿！`);
      wishTitles = []; wishImg = '';
      vWishpost();
    } catch (e) { btn.disabled = false; btn.textContent = `${titles.length} 条全部发布`; toast(e.message); }
  };
}
function bindWishSingle() {
  bindWishChips('#ws-pickup');
  $('#ws-extra-toggle').onclick = () => {
    const box = $('#ws-extra');
    const open = box.style.display !== 'none';
    box.style.display = open ? 'none' : 'block';
    $('#ws-extra-toggle').textContent = open ? '展开选填项 ▼' : '收起选填项 ▲';
  };
  $('#ws-file').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      wishImg = await compressImage(f, 800, 200);
      $('#ws-upbox').innerHTML = `<img src="${wishImg}">`;
    } catch (err) { toast(err.message); }
  };
  $('#ws-go').onclick = async () => {
    const title = $('#ws-title').value.trim();
    const course = $('#ws-course').value.trim();
    const note = $('#ws-note').value.trim();
    const loc = $('#ws-loc').value.trim();
    if (title.length < 1) return toast('请填写书名');
    if (loc.length > 30) return toast('地点最多 30 字');
    if (!wishPickup && loc.length < 2) return toast('请填写交易地点（2-30 字；选"可自提"时可以不填）');
    const btn = $('#ws-go'); btn.disabled = true;
    try {
      const d = await POST('/wishes', { title, course, note, location: loc, pickup_ok: wishPickup });
      if (wishImg) {
        const fd = new FormData();
        fd.append('file', dataUrlToBlob(wishImg), 'wish.jpg');
        await api('POST', `/wishes/${d.id}/photo`, fd, true);
      }
      toast('心愿已发布！');
      wishImg = '';
      vWishpost();
    } catch (e) { btn.disabled = false; toast(e.message); }
  };
}
async function loadMyWishes() {
  try {
    const d = await GET('/wishes/mine');
    const head = $('#mywish-count');
    if (head) head.textContent = `我的心愿（${d.list.length}）`;
    $('#mywish-list').innerHTML = d.list.length ? d.list.map((w) => {
      const st = w.status === 'on' ? '<span class="tag">显示中</span>' : '<span class="tag gray">已下架</span>';
      return `<div class="book-card" data-id="${w.id}" onclick="go('#/wish/${w.id}')">
        ${w.photo ? `<img class="cover" src="/files/wishes/${w.id}.jpg" onerror="this.style.visibility='hidden'">` : '<div class="cover">🙏</div>'}
        <div class="bc-body">
          <div class="bc-title">${esc(w.title)}</div>
          <div style="margin-top:3px">${st}${w.pickup_ok ? '<span class="tag" style="background:var(--brand-soft);color:var(--brand)">🤝 可自提</span>' : ''}${w.unread_chats > 0 ? `<span class="tag red">💬 ${w.unread_chats} 未读</span>` : ''}</div>
          <div class="bc-meta">🙋 ${esc(w.buyer?.nickname || '')} · ${fmtTime(w.created_at)}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button class="btn small ghost" onclick="event.stopPropagation();wishSetStatus(${w.id},'${w.status === 'on' ? 'off' : 'on'}')">${w.status === 'on' ? '下架' : '重新上架'}</button>
          <button class="btn small danger" onclick="event.stopPropagation();wishSetStatus(${w.id},'done')">已买到</button>
          <button class="btn small ghost" onclick="event.stopPropagation();changeWishPhoto(${w.id}, event)">换图</button>
        </div>
      </div>`;
    }).join('') : '<div class="empty">还没有发过心愿</div>';
  } catch (e) { $('#mywish-list').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function wishSetStatus(id, st) {
  try {
    await POST(`/wishes/${id}/status`, { status: st });
    toast(st === 'done' ? '已标记买到，心愿删除' : '已更新');
    loadMyWishes();
  } catch (e) { toast(e.message); }
}
function changeWishPhoto(id, ev) {
  ev?.stopPropagation();
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    if (!inp.files[0]) return;
    try {
      const img = await compressImage(inp.files[0], 800, 200);
      const fd = new FormData();
      fd.append('file', dataUrlToBlob(img), 'wish.jpg');
      await api('POST', `/wishes/${id}/photo`, fd, true);
      toast('参考图已更新'); loadMyWishes();
    } catch (e) { toast(e.message); }
  };
  inp.click();
}

// ---------- 心愿详情 ----------
async function vWishDetail(hash) {
  const id = hash.split('/')[2];
  if (!id) return navTo('#/wishlist');
  const d = await GET('/wishes/' + id);
  const cover = d.photo ? `<div class="detail-cover"><img src="/files/wishes/${d.id}.jpg" onerror="this.parentNode.innerHTML='<div style=padding:60px>🙏</div>'"></div>` : '';
  $('#view').innerHTML = `
    ${cover}
    <div class="row" style="align-items:flex-start;margin:12px 2px 6px">
      <div class="grow"><div class="d-title" style="margin:0">${esc(d.title)}</div></div>
      ${d.pickup_ok ? '<span class="d-note" style="color:var(--brand)">🤝 可自提</span>' : ''}
    </div>
    <div style="margin:0 2px 10px">
      ${d.status === 'on' ? '<span class="tag">求购中</span>' : '<span class="tag gray">已下架</span>'}
      ${d.course ? `<span class="tag gray">📘 ${esc(d.course)}</span>` : ''}
      ${d.location ? `<span class="tag gray">📍 ${esc(d.location)}</span>` : ''}
    </div>
    ${d.note ? `<div class="card"><div class="sub" style="margin-bottom:4px">补充说明</div>${esc(d.note)}</div>` : ''}
    <div class="card seller-card">
      <div class="avatar">${esc((d.buyer?.nickname || '友')[0])}</div>
      <div class="grow">
        <div style="font-weight:700">${esc(d.buyer?.nickname || '')} 想买这本书</div>
        <div class="sub">在售 ${d.buyer?.books_on ?? 0} 本 · 注册 ${fmtTime(d.buyer?.created_at)}</div>
      </div>
      <button class="btn small ghost" onclick="go('#/user/${d.buyer?.id}')">看主页</button>
    </div>
    <div class="card tips-card">
      <div class="sub">平台仅提供信息展示与联系，不参与交易：先聊清<b>版本与品相</b>，<b>见面当面验书、满意再付款</b>。</div>
    </div>
    ${d.is_mine
      ? `<button class="btn ghost" onclick="go('#/wishpost')">管理我的心愿（求购页）</button>`
      : (d.my_thread
        ? `<button class="btn" onclick="go('#/chat/wish/${d.my_thread.chat_id}')">继续聊天</button>`
        : (d.status === 'on' ? `<button class="btn" id="wish-contact-btn">💬 我有这本书，联系 TA</button>` : ''))}`;
  const cb = $('#wish-contact-btn');
  if (cb) cb.onclick = async () => {
    cb.disabled = true;
    try {
      const r = await POST(`/wishes/${id}/contact`, {});
      toast('已联系心愿主，去消息里聊吧');
      go('#/chat/wish/' + r.chat_id);
    } catch (e) { cb.disabled = false; toast(e.message); }
  };
}

// ---------- 消息（会话列表） ----------
async function vInbox() {
  // 书市聊天 + 心愿聊天合并展示，按最后消息时间排序（两模式共用消息 Tab）
  const [b, w] = await Promise.all([GET('/book-chats'), GET('/wish-chats')]);
  const rows = [
    ...b.list.map((c) => ({ ...c, kind: 'book' })),
    ...w.list.map((c) => ({ ...c, kind: 'wish' })),
  ].sort((x, y) => (y.last_message?.created_at || 0) - (x.last_message?.created_at || 0));
  $('#view').innerHTML = `<h2 class="sec">消息</h2><div id="chat-rows">${
    rows.length ? rows.map((c) => {
      const isWish = c.kind === 'wish';
      const title = isWish ? `《${esc(c.wish?.title || '已删除的心愿')}》` : `《${esc(c.book?.title || '已删除的书')}》`;
      const cover = isWish
        ? (c.wish?.photo ? `<img class="cover" src="/files/wishes/${c.wish.id}.jpg" onerror="this.style.visibility='hidden'">` : '<div class="cover">🙏</div>')
        : (c.book?.photo ? `<img class="cover" src="/files/books/${c.book.id}.jpg" onerror="this.style.visibility='hidden'">` : '<div class="cover">📖</div>');
      const off = isWish
        ? (c.wish && c.wish.status !== 'on' ? ' · 心愿已下架/删除' : '')
        : (c.book && c.book.status !== 'on' ? ' · 书已下架/售出' : '');
      const roleCn = isWish ? (c.role === 'buyer' ? '卖家' : '心愿主') : (c.role === 'seller' ? '买家' : '卖家');
      return `
      <div class="chat-row" onclick="go('#/chat/${isWish ? 'wish/' : ''}${c.id}')">
        ${cover}
        <div class="cr-body">
          <div class="cr-name">${isWish ? '<span class="tag" style="background:var(--brand-soft);color:var(--brand)">心愿</span> ' : ''}${title}${c.unread > 0 ? `<span class="badge" style="position:static;margin-left:6px">${c.unread}</span>` : ''}</div>
          <div class="cr-last">${c.last_message ? esc(c.last_message.text || '[图片消息]') : ''}</div>
          <div class="sub">${roleCn}：${esc(c.other?.nickname || '')}${off}</div>
        </div>
      </div>`;
    }).join('') : '<div class="empty"><div class="big">💬</div>还没有聊天<br>在书市联系卖家、或卖家联系心愿后会出现在这里</div>'
  }</div>`;
}

// ---------- 聊天 ----------
let chatPoll = null;
let chatKind = 'book'; // 'book' 书市聊天 / 'wish' 心愿聊天，hash 形如 #/chat/wish/6（不带 kind 默认书市）
const chatApi = () => (chatKind === 'wish' ? '/wish-chats' : '/book-chats');
async function vChat(hash) {
  const parts = hash.split('/');
  chatKind = parts.length >= 4 && parts[2] === 'wish' ? 'wish' : 'book';
  const id = parts[parts.length - 1];
  const meta = (await GET(chatApi())).list.find((c) => String(c.id) === String(id));
  const title = chatKind === 'wish'
    ? `心愿《${esc(meta?.wish?.title || '已删除的心愿')}》`
    : `《${esc(meta?.book?.title || '已删除的书')}》`;
  const subLine = chatKind === 'wish'
    ? `对方：${esc(meta?.other?.nickname || '')}`
    : `${meta?.book ? (meta.book.price_cents > 0 ? yuan(meta.book.price_cents) : esc(meta.book.price_note || '')) : ''} · 对方：${esc(meta?.other?.nickname || '')}`;
  $('#view').className = 'flush chatpage';
  $('#view').innerHTML = `
    <div class="chat-meta">
      <button class="back-btn" onclick="history.back()">‹</button>
      <div class="grow" style="min-width:0">
        <div style="font-weight:800;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</div>
        <div class="sub">${subLine}</div>
      </div>
    </div>
    <div class="chat-wrap">
      <div class="chat-list" id="msgs"><div class="empty">加载中…</div></div>
      <div class="chat-input"><input id="msg-in" placeholder="输入消息…"><button id="msg-send">发送</button></div>
    </div>`;
  POST(`${chatApi()}/${id}/read`, {}).catch(() => {});
  await loadMsgs(id);
  $('#msg-send').onclick = () => sendMsg(id);
  $('#msg-in').onkeydown = (e) => { if (e.key === 'Enter') sendMsg(id); };
  clearInterval(chatPoll);
  chatPoll = setInterval(() => { if (location.hash === hash) loadMsgs(id, true); else clearInterval(chatPoll); }, 3000);
}
async function loadMsgs(id, quiet) {
  const box = $('#msgs');
  if (!box) return;
  try {
    const d = await GET(`${chatApi()}/${id}/messages`);
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.innerHTML = d.list.map((m) => {
      if (m.type === 'system') return `<div class="msg"><div class="bubble sys">${esc(m.text)}</div></div>`;
      const mine = m.sender_id === (window._myId || 0);
      return `<div class="msg ${mine ? 'me' : ''}"><div class="bubble">${esc(m.text || '[位置消息]')}</div></div>`;
    }).join('');
    if (atBottom || !quiet) box.scrollTop = box.scrollHeight;
    POST(`${chatApi()}/${id}/read`, {}).catch(() => {});
  } catch (e) { if (!quiet) box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function sendMsg(id) {
  const inp = $('#msg-in');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  try {
    await POST(`${chatApi()}/${id}/messages`, { text });
    await loadMsgs(id, true);
  } catch (e) { toast(e.message); }
}

// ---------- 通知 ----------
async function vNotifications() {
  const data = await GET('/notifications');
  $('#view').innerHTML = `<h2 class="sec">消息通知</h2><div id="nlist">${
    data.list.length ? data.list.map((n) => `
      <div class="notif-card">
        <b>${esc(n.title)}</b> <span class="muted">${fmtTime(n.created_at)}</span>
        <div class="sub" style="margin-top:4px;line-height:1.6">${esc(n.body)}</div>
        ${(() => { const dd = n.data_json && JSON.parse(n.data_json); return dd && dd.chat_id ? `<button class="btn small" style="margin-top:8px" onclick="go('#/chat/${dd.kind === 'wish' ? 'wish/' : ''}${dd.chat_id}')">去回复</button>` : ''; })()}
      </div>`).join('') : '<div class="empty"><div class="big">🔔</div>暂无消息</div>'
  }</div>`;
  POST('/notifications/read', {}).then(loadBell).catch(() => {});
}

// ---------- 邀请 ----------
async function vInvite() {
  const d = await GET('/invite');
  // 绑定邀请人卡片：未绑定时显示输入行（每人限一次），已绑定显示好友名
  const bindBlock = d.inviter_name
    ? `<div class="agree-row" style="margin-top:10px"><span style="font-size:15px">🤝</span><div class="sub">已与 <b style="color:var(--ink)">${esc(d.inviter_name)}</b> 成为好友（每人限填一次邀请码）</div></div>`
    : `<div class="row" style="margin-top:10px">
        <input id="bind-code" class="grow" placeholder="输入好友的邀请码" style="border:1.5px solid var(--line);border-radius:12px;padding:10px 12px;background:#fff;font-size:13px" oninput="this.value=this.value.toUpperCase()">
        <button class="btn small" id="bind-go">绑定</button>
      </div>
      <div class="muted" style="font-size:11px;margin-top:6px">在这里填 TA 的邀请码即可成为好友（每人限一次，绑定后不可更改）</div>`;
  $('#view').innerHTML = `
    <div class="card center" style="background:linear-gradient(135deg,#0f8a5f,#16a06f);color:#fff">
      <div style="font-size:15px;opacity:.9">你的邀请码</div>
      <div style="font-size:34px;font-weight:800;letter-spacing:6px;margin:8px 0" id="inv-code">${esc(d.invite_code)}</div>
      <button class="btn small" style="margin:0 auto" onclick="navigator.clipboard.writeText($('#inv-code').textContent).then(()=>toast('邀请码已复制'))">复制邀请码</button>
    </div>
    <div class="card"><div class="sub">把邀请码或邀请链接分享给同学即可成为好友。已邀请 <b>${d.invited_count}</b> 位同学。</div>
      ${bindBlock}
    </div>
    <div class="card" style="background:linear-gradient(135deg,#e6f5ee,#f2fbf7)">
      <div class="row">
        <div style="font-size:24px">🔗</div>
        <div class="grow">
          <b style="font-size:14px">复制邀请链接</b>
          <div class="sub" style="margin-top:2px;word-break:break-all" id="inv-link">${esc(location.origin + '/#/login?invite=' + d.invite_code)}</div>
        </div>
        <button class="btn small" onclick="navigator.clipboard.writeText($('#inv-link').textContent).then(()=>toast('链接已复制，发给同学吧'))">复制</button>
      </div>
    </div>
    <h2 class="sec">我邀请的好友（${d.friends.length}）</h2>
    ${d.friends.length ? d.friends.map((f) => `<div class="card seller-card"><div class="avatar">${esc(f.nickname[0])}</div><div><b>${esc(f.nickname)}</b><div class="sub">${fmtTime(f.created_at)} 加入</div></div></div>`).join('') : '<div class="empty">还没有邀请好友</div>'}`;
  const goBind = $('#bind-go');
  if (goBind) goBind.onclick = async () => {
    const code = $('#bind-code').value.trim();
    if (!code) return toast('请填写邀请码');
    goBind.disabled = true;
    try {
      const r = await POST('/invite/bind', { code });
      toast(`成功！你和 ${r.inviter_name} 现在是好友啦`);
      vInvite();
    } catch (e) { goBind.disabled = false; toast(e.message); }
  };
}

// ---------- 我的 ----------
async function vMe() {
  const me = await GET('/auth/me');
  window._myId = me.id;
  $('#view').innerHTML = `
    <div class="card seller-card">
      <div class="avatar" id="me-avatar" onclick="changeAvatar()">${me.avatar ? `<img src="/files/avatars/${me.id}.jpg">` : esc(me.nickname[0])}</div>
      <div class="grow"><b style="font-size:16px">${esc(me.nickname)}</b>
        <div class="sub">${esc(me.email)}</div>
        <div class="sub">${esc(me.school || '')}</div></div>
      <button class="btn small ghost" onclick="changeAvatar()">换头像</button>
    </div>
    <div class="card seller-card">
      <div class="avatar" style="background:#e6f5ee;color:#0f8a5f">🎁</div>
      <div class="grow"><b>邀请好友</b><div class="sub">把邀请码分享给同学</div></div>
      <button class="btn small ghost" onclick="go('#/invite')">查看</button>
    </div>
    <div class="card seller-card" onclick="go('#/feedback')" style="cursor:pointer">
      <div class="avatar" style="background:#e6f5ee;color:#0f8a5f">💬</div>
      <div class="grow"><b>意见反馈</b><div class="sub">问题和建议都会直达开发者</div></div>
      <button class="btn small ghost">去反馈</button>
    </div>
    <div class="card">
      <div class="sub" style="line-height:1.8">WHU二手书市 · 网页版 v1.1<br>平台仅提供信息展示，不参与交易。<br>线下交易请当面验书、当面付款。</div>
    </div>
    <button class="btn danger" onclick="logout()">退出登录</button>
    <input type="file" id="av-file" accept="image/*" class="hidden">`;
}
// ---------- 意见反馈（独立页，从「我的」进入） ----------
function vFeedback() {
  $('#view').innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
        <div class="avatar" style="background:#e6f5ee;color:#0f8a5f">💬</div>
        <div class="grow"><b style="font-size:15px">意见反馈</b><div class="sub">问题和建议都会直达开发者</div></div>
      </div>
      <div class="field"><textarea id="fb-text" rows="6" maxlength="500" placeholder="说说你遇到的问题或想加的功能（5-500 字）&#10;例如：希望搜索结果能按课程筛选"></textarea></div>
      <div class="sub" style="text-align:right;margin:-8px 2px 14px"><span id="fb-count">0</span>/500</div>
      <button class="btn" id="fb-go">提交反馈</button>
      <div class="center muted" style="margin-top:12px;font-size:11.5px">每一条反馈开发者都会亲自看，感谢帮书市变得更好 🌱</div>
    </div>`;
  const ta = $('#fb-text');
  ta.oninput = () => { $('#fb-count').textContent = ta.value.length; };
  $('#fb-go').onclick = submitFeedback;
}

async function submitFeedback() {
  const text = ($('#fb-text') || {}).value?.trim() || '';
  if (text.length < 5) return toast('反馈内容至少 5 个字');
  if (text.length > 500) return toast('反馈内容最多 500 字');
  const btn = $('#fb-go'); btn.disabled = true; btn.textContent = '提交中…';
  try {
    await POST('/feedback', { content: text });
    toast('感谢反馈！已直达开发者');
    navTo('#/me');
  } catch (e) {
    btn.disabled = false; btn.textContent = '提交反馈';
    toast(e.message);
  }
}

function logout() {
  if (!confirm('退出登录？')) return;
  setToken(''); ws?.close(); ws = null; clearInterval(chatPoll);
  location.hash = '#/login'; render();
}
function changeAvatar() {
  const inp = $('#av-file');
  inp.onchange = async () => {
    if (!inp.files[0]) return;
    try {
      const img = await compressImage(inp.files[0], 512, 200);
      const fd = new FormData();
      fd.append('file', dataUrlToBlob(img), 'avatar.jpg');
      await api('POST', '/auth/me/avatar', fd, true);
      toast('头像已更新'); vMe();
    } catch (e) { toast(e.message); }
  };
  inp.click();
}

// ---------- 他人主页 ----------
async function vUser(hash) {
  const id = hash.split('/')[2];
  const d = await GET(`/users/${id}/profile`);
  const u = d.user;
  if (!u) { $('#view').innerHTML = '<div class="empty">用户不存在</div>'; return; }
  $('#view').innerHTML = `
    <div class="card seller-card">
      <div class="avatar">${u.avatar ? `<img src="/files/avatars/${u.id}.jpg">` : esc(u.nickname[0])}</div>
      <div class="grow"><b style="font-size:16px">${esc(u.nickname)}</b>
        <div class="sub">${esc(u.school || '')}</div>
        <div class="sub">注册 ${fmtTime(u.created_at)}</div></div>
    </div>
    <div class="row" style="margin:0 2px 10px">
      <div class="card" style="flex:1;text-align:center;margin:0"><div style="font-size:20px;font-weight:800;color:#0f8a5f">${u.books_on}</div><div class="sub">在售</div></div>
      <div class="card" style="flex:1;text-align:center;margin:0"><div style="font-size:20px;font-weight:800;color:#0f8a5f">${u.books_sold}</div><div class="sub">已售出</div></div>
    </div>
    <h2 class="sec">在售的书</h2>
    ${u.books.length ? u.books.map(bookCardHtml).join('') : '<div class="empty">暂无在售书籍</div>'}`;
  document.querySelectorAll('#view .book-card').forEach((el) => el.onclick = () => go('#/book/' + el.dataset.id));
}

// ---------- 初始化 ----------
window._myId = 0;
if (isLogin()) {
  GET('/auth/me').then((u) => { window._myId = u.id; }).catch(() => {});
}
render();

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
        if (ev.t === 'bchat') {
          loadMsgBadge();
          if (location.hash.startsWith('#/inbox')) render();
          const m = location.hash.match(/^#\/chat\/(\d+)/);
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
    const d = await GET('/book-chats/unread-count');
    const n = d.count ?? d.unread ?? 0;
    const b = $('#tab-msg-badge');
    b.textContent = n;
    b.classList.toggle('hidden', !n);
  } catch {}
}

// ---------- 路由 ----------
const routes = {
  '#/login': vLogin, '#/register': vRegister,
  '#/browse': vBrowse, '#/book': vBook, '#/sell': vSell,
  '#/inbox': vInbox, '#/chat': vChat,
  '#/notifications': vNotifications,
  '#/invite': vInvite, '#/me': vMe, '#/user': vUser,
};
function go(hash) { location.hash = hash; }
// 关键：目标 hash 与当前相同时 location.hash 赋值不会触发 hashchange，
// 必须手动 render —— 登录成功后曾因此卡在登录页（URL 已变视图未变）
function navTo(hash) { if (location.hash === hash) render(); else location.hash = hash; }

// 摆放示例灯箱：展示标准摆拍照片，点击任意处关闭
function showExample(ev) {
  ev?.stopPropagation();
  const ov = document.createElement('div');
  ov.className = 'img-overlay';
  ov.innerHTML = `<div class="img-box"><img src="/example-books.jpg" alt="摆放示例"><div class="sub" style="color:#dfe5e9;margin-top:10px">像这样把书竖直排开、书名朝外拍一张 ↑ 点击任意处关闭</div></div>`;
  ov.onclick = () => ov.remove();
  document.body.appendChild(ov);
}

function render() {
  let hash = location.hash || '#/browse';
  const logged = isLogin();
  // 未登录一律先到登录/注册页
  if (!logged && !hash.startsWith('#/login') && !hash.startsWith('#/register')) hash = '#/login';
  $('#topbar').classList.toggle('hidden', !logged);
  $('#bell').classList.toggle('hidden', !logged || hash.startsWith('#/notifications'));
  $('#tabbar').classList.toggle('hidden', !logged);
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
function vLogin() {
  $('#view').innerHTML = `
    <div style="background:radial-gradient(circle at 85% -20%,rgba(255,255,255,.15) 0 70px,transparent 71px),linear-gradient(135deg,#0d7a54,#12a06f);color:#fff;border-radius:0 0 26px 26px;margin:-12px -14px 18px;padding:42px 26px 60px">
      <div style="font-size:30px;font-weight:800;letter-spacing:1px;display:flex;align-items:center;gap:12px">
        <img src="/appicon.png" style="width:46px;height:46px">WHU二手书市</div>
      <div style="font-size:13px;opacity:.92;margin-top:8px">教材课本 · 让好书继续流转</div>
    </div>
    <div class="card overlap">
      <div class="field"><label>邮箱（武大邮箱或其他邮箱均可）</label><input id="lg-email" type="email" placeholder="邮箱"></div>
      <div class="field"><label>验证码</label><div class="row"><input id="lg-code" class="grow" placeholder="6 位验证码"><button class="btn small" id="lg-send">获取验证码</button></div></div>
      <button class="btn" id="lg-btn">登 录</button>
      <div class="center muted" style="margin-top:12px">没有账号？<span class="linkish" onclick="go('#/register')">去注册</span></div>
    </div>`;
  bindCode('#lg-email', '#lg-send', 'login');
  $('#lg-btn').onclick = async () => {
    try {
      const d = await POST('/auth/login', { email: $('#lg-email').value.trim(), code: $('#lg-code').value.trim() });
      setToken(d.token); window._myId = d.user.id; toast('登录成功'); navTo('#/browse');
    } catch (e) { toast(e.message); }
  };
}

function vRegister() {
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
      const h = setInterval(() => { btn.textContent = (--sec) + 's'; if (sec <= 0) { clearInterval(h); btn.disabled = false; btn.textContent = '获取验证码'; } }, 1000);
    } catch (e) { btn.disabled = false; btn.textContent = '获取验证码'; toast(e.message); }
  };
}

// ---------- 书市 ----------
let browseQ = '', browseSort = 'latest';
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
async function loadBrowse() {
  $('#blist').innerHTML = '<div class="empty">加载中…</div>';
  try {
    const d = await GET(`/books?q=${encodeURIComponent(browseQ)}&sort=${browseSort}`);
    if (!d.list.length) { $('#blist').innerHTML = '<div class="empty"><div class="big">📚</div>暂时没有在售的书<br>去「卖书」发布第一本吧</div>'; return; }
    $('#blist').innerHTML = d.list.map(bookCardHtml).join('');
    document.querySelectorAll('#blist .book-card').forEach((el) => el.onclick = () => go('#/book/' + el.dataset.id));
  } catch (e) { $('#blist').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
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
      <div style="margin-top:3px">${b.cond_cn ? `<span class="tag">${esc(b.cond_cn)}</span>` : ''}${b.course ? `<span class="tag gray">📘 ${esc(b.course)}</span>` : ''}</div>
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
        : (b.status === 'on' ? `<button class="btn" id="contact-btn">💬 联系卖家</button>` : ''))}
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
    <div class="field" style="margin-top:12px"><label>书名（识别后请核对，可增删改）<button class="chip small" style="float:right" id="add-one">+ 添加一本</button></label><div id="titles"></div></div>
    <div class="field"><label>交易地点（必填，所有书共用）</label><input id="bt-loc" placeholder="当面交书的地点"></div>
    <div class="field"><label>价格描述（必填，1-60 字，所有书共用）</label><input id="bt-price" placeholder="例如：左边10r/本，右边20r/本"></div>
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
  document.querySelectorAll('.bt-title').forEach((inp) => inp.oninput = () => { batchTitles[+inp.dataset.i] = inp.value; const n = batchTitles.filter((t) => t.trim()).length; $('#bt-go').textContent = `${n} 本全部发布`; });
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
    if (!confirm(`将一次发布 ${titles.length} 本独立的书：共用合照封面、地点「${loc}」、价格描述「${price}」。确认发布？`)) return;
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
    if (!confirm(`《${title}》定价 ${(price / 100).toFixed(2)} 元。平台仅提供信息展示，请与买家当面验书、当面付款。确认发布？`)) return;
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
  if (sold && !confirm('标记后本书所有信息将从平台删除，且无法再与买家取得联系。确认已当面交接？')) return;
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

// ---------- 消息（会话列表） ----------
async function vInbox() {
  const d = await GET('/book-chats');
  $('#view').innerHTML = `<h2 class="sec">书市消息</h2><div id="chat-rows">${
    d.list.length ? d.list.map((c) => `
      <div class="chat-row" onclick="go('#/chat/${c.id}')">
        ${c.book?.photo ? `<img class="cover" src="/files/books/${c.book.id}.jpg" onerror="this.style.visibility='hidden'">` : '<div class="cover">📖</div>'}
        <div class="cr-body">
          <div class="cr-name">《${esc(c.book?.title || '已删除的书')}》${c.unread > 0 ? `<span class="badge" style="position:static;margin-left:6px">${c.unread}</span>` : ''}</div>
          <div class="cr-last">${c.last_message ? esc(c.last_message.text || '[图片消息]') : ''}</div>
          <div class="sub">${c.role === 'seller' ? '买家' : '卖家'}：${esc(c.other?.nickname || '')}${c.book?.status !== 'on' ? ' · 书已下架/售出' : ''}</div>
        </div>
      </div>`).join('') : '<div class="empty"><div class="big">💬</div>还没有聊天<br>在书市里联系卖家/买家后会出现在这里</div>'
  }</div>`;
}

// ---------- 聊天 ----------
let chatPoll = null;
async function vChat(hash) {
  const id = hash.split('/')[2];
  const meta = (await GET('/book-chats')).list.find((c) => String(c.id) === String(id));
  $('#view').className = 'flush chatpage';
  $('#view').innerHTML = `
    <div class="chat-meta">
      <button class="back-btn" onclick="history.back()">‹</button>
      <div class="grow" style="min-width:0">
        <div style="font-weight:800;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">《${esc(meta?.book?.title || '已删除的书')}》</div>
        <div class="sub">${meta?.book ? (meta.book.price_cents > 0 ? yuan(meta.book.price_cents) : esc(meta.book.price_note || '')) : ''} · 对方：${esc(meta?.other?.nickname || '')}</div>
      </div>
    </div>
    <div class="chat-wrap">
      <div class="chat-list" id="msgs"><div class="empty">加载中…</div></div>
      <div class="chat-input"><input id="msg-in" placeholder="输入消息…"><button id="msg-send">发送</button></div>
    </div>`;
  POST(`/book-chats/${id}/read`, {}).catch(() => {});
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
    const d = await GET(`/book-chats/${id}/messages`);
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.innerHTML = d.list.map((m) => {
      if (m.type === 'system') return `<div class="msg"><div class="bubble sys">${esc(m.text)}</div></div>`;
      const mine = m.sender_id === (window._myId || 0);
      return `<div class="msg ${mine ? 'me' : ''}"><div class="bubble">${esc(m.text || '[位置消息]')}</div></div>`;
    }).join('');
    if (atBottom || !quiet) box.scrollTop = box.scrollHeight;
    POST(`/book-chats/${id}/read`, {}).catch(() => {});
  } catch (e) { if (!quiet) box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function sendMsg(id) {
  const inp = $('#msg-in');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  try {
    await POST(`/book-chats/${id}/messages`, { text });
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
        ${n.data_json && JSON.parse(n.data_json).chat_id ? `<button class="btn small" style="margin-top:8px" onclick="go('#/chat/${JSON.parse(n.data_json).chat_id}')">去回复</button>` : ''}
      </div>`).join('') : '<div class="empty"><div class="big">🔔</div>暂无消息</div>'
  }</div>`;
  POST('/notifications/read', {}).then(loadBell).catch(() => {});
}

// ---------- 邀请 ----------
async function vInvite() {
  const d = await GET('/invite');
  $('#view').innerHTML = `
    <div class="card center" style="background:linear-gradient(135deg,#0f8a5f,#16a06f);color:#fff">
      <div style="font-size:15px;opacity:.9">你的邀请码</div>
      <div style="font-size:34px;font-weight:800;letter-spacing:6px;margin:8px 0" id="inv-code">${esc(d.invite_code)}</div>
      <button class="btn small" style="margin:0 auto" onclick="navigator.clipboard.writeText($('#inv-code').textContent).then(()=>toast('邀请码已复制'))">复制邀请码</button>
    </div>
    <div class="card"><div class="sub">把邀请码分享给同学，注册时填写即可成为好友。已邀请 <b>${d.invited_count}</b> 位同学。</div></div>
    <h2 class="sec">我邀请的好友（${d.friends.length}）</h2>
    ${d.friends.length ? d.friends.map((f) => `<div class="card seller-card"><div class="avatar">${esc(f.nickname[0])}</div><div><b>${esc(f.nickname)}</b><div class="sub">${fmtTime(f.created_at)} 加入</div></div></div>`).join('') : '<div class="empty">还没有邀请好友</div>'}`;
}

// ---------- 我的 ----------
async function vMe() {
  const me = await GET('/auth/me');
  window._myId = me.id;
  $('#view').innerHTML = `
    <div class="card seller-card">
      <div class="avatar" id="me-avatar" onclick="changeAvatar()">${me.avatar ? `<img src="/files/avatars/${me.id}.jpg">` : esc(me.nickname[0])}</div>
      <div class="grow"><b style="font-size:16px">${esc(me.nickname)}</b>
        <div class="sub">${me.gender === 'male' ? '男' : '女'} · ${esc(me.email)}</div>
        <div class="sub">${esc(me.school || '')}</div></div>
      <button class="btn small ghost" onclick="changeAvatar()">换头像</button>
    </div>
    <div class="card seller-card">
      <div class="avatar" style="background:#e6f5ee;color:#0f8a5f">🎁</div>
      <div class="grow"><b>邀请好友</b><div class="sub">把邀请码分享给同学</div></div>
      <button class="btn small ghost" onclick="go('#/invite')">查看</button>
    </div>
    <div class="card">
      <div class="sub" style="line-height:1.8">WHU二手书市 · 网页版 v1.0<br>平台仅提供信息展示，不参与交易。<br>线下交易请当面验书、当面付款。</div>
    </div>
    <button class="btn danger" onclick="logout()">退出登录</button>
    <input type="file" id="av-file" accept="image/*" class="hidden">`;
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
        <div class="sub">${u.gender === 'male' ? '男' : '女'} · ${esc(u.school || '')}</div>
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

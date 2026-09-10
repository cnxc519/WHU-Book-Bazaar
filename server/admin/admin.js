// 乐乐书市 管理后台（纯二手书市）
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yuan = (fen) => (fen / 100).toFixed(2);
const fmt = (ts) => ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '';

let TOKEN = localStorage.getItem('lele_admin_token') || '';
let currentView = 'dashboard';

async function api(method, path, body) {
  const r = await fetch('/api/admin' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  // token 失效/错误：回到登录态，避免停在空白后台
  if (r.status === 401) {
    TOKEN = '';
    localStorage.removeItem('lele_admin_token');
    showLogin();
    throw new Error('登录已失效，请重新登录');
  }
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.error?.msg || '请求失败');
  return j.data;
}
function showLogin() {
  $('#login-box').classList.remove('hidden');
  $('#app').classList.add('hidden');
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 2500);
}
function render(html) { $('#main').innerHTML = html; }

// ---------- 登录 ----------
async function doLogin() {
  const u = $('#login-user').value.trim(), p = $('#login-pass').value;
  $('#login-err').textContent = '';
  try {
    const d = await api('POST', '/login', { username: u, password: p });
    TOKEN = d.token;
    localStorage.setItem('lele_admin_token', TOKEN);
    $('#login-box').classList.add('hidden');
    $('#app').classList.remove('hidden');
    go('dashboard');
  } catch (e) { $('#login-err').textContent = e.message; }
}

function go(view) {
  currentView = view;
  $$('#sidebar nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  ({ dashboard: vDashboard, schools: vSchools, notices: vNotices, users: vUsers, books: vBooks, bookreports: vBookReports, version: vVersion })[view]();
}

// 侧栏角标（待处理举报数）
function setBadges(openBookReports) {
  const bb = $('#bookreport-badge');
  bb.textContent = openBookReports; bb.classList.toggle('hidden', !openBookReports);
}
function refreshBadges() {
  api('GET', '/dashboard').then((d) => setBadges(d.open_book_reports)).catch(() => {});
}

// ---------- 概览 ----------
async function vDashboard() {
  try {
    const d = await api('GET', '/dashboard');
    render(`
      <div class="stat-grid">
        <div class="stat"><div class="num">${d.books_on}</div><div class="lbl">书市在售</div></div>
        <div class="stat"><div class="num">${d.open_book_reports}</div><div class="lbl">待处理书举报</div></div>
      </div>
      </div>`);
    setBadges(d.open_book_reports);
  } catch (e) { render(`<div class="card">加载失败：${esc(e.message)}</div>`); }
}

// ---------- 学校管理 ----------
async function vSchools() {
  const d = await api('GET', '/schools');
  render(`
    <div class="card">
      <h2>学校管理（App 注册时学校只可选择）</h2>
      <div class="toolbar">
        <input id="school-name" placeholder="学校名称，如：武汉大学">
        <button class="primary" onclick="addSchool()">添加学校</button>
      </div>
      <table>
        <tr><th>ID</th><th>学校</th></tr>
        ${d.list.map((s) => `<tr><td>${s.id}</td><td>${esc(s.name)}</td></tr>`).join('')}
      </table>
    </div>`);
}
async function addSchool() {
  const name = $('#school-name').value.trim();
  if (!name) return toast('请填写学校名称');
  try { await api('POST', '/schools', { name }); toast('已添加'); vSchools(); }
  catch (e) { toast(e.message); }
}

// ---------- 公告管理 ----------
async function vNotices() {
  const d = await api('GET', '/notices');
  render(`
    <div class="card">
      <h2>公告管理（发布后 App 公告栏可见；可下线不再展示）</h2>
      <div class="toolbar">
        <input id="nt-title" placeholder="公告标题（1-50 字）" style="width:230px">
        <input id="nt-content" placeholder="公告内容（1-2000 字）" style="flex:1">
        <button class="primary" onclick="addNotice()">发布公告</button>
      </div>
      <table>
        <tr><th>ID</th><th>标题</th><th>内容</th><th>时间</th><th>状态</th><th>操作</th></tr>
        ${d.list.map((n) => `<tr>
          <td>${n.id}</td>
          <td>${esc(n.title)}</td>
          <td style="max-width:360px">${esc(n.content)}</td>
          <td>${fmt(n.created_at)}</td>
          <td>${n.status === 'offline' ? '<span class="tag">已下线</span>' : '<span class="tag blue">展示中</span>'}</td>
          <td>
            <button class="small" onclick="toggleNotice(${n.id}, '${n.status === 'offline' ? 'active' : 'offline'}')">${n.status === 'offline' ? '上架' : '下线'}</button>
            <button class="small danger" onclick="delNotice(${n.id})">删除</button>
          </td></tr>`).join('')}
      </table>
    </div>`);
}
async function addNotice() {
  const title = $('#nt-title').value.trim(), content = $('#nt-content').value.trim();
  if (!title || !content) return toast('请填写标题和内容');
  try { await api('POST', '/notices', { title, content }); toast('已发布'); vNotices(); }
  catch (e) { toast(e.message); }
}
async function toggleNotice(id, status) {
  try { await api('PUT', `/notices/${id}`, { status }); toast('已更新'); vNotices(); }
  catch (e) { toast(e.message); }
}
async function delNotice(id) {
  if (!confirm('确定删除该公告？')) return;
  try { await api('DELETE', `/notices/${id}`); toast('已删除'); vNotices(); }
  catch (e) { toast(e.message); }
}

// ---------- 用户管理 ----------
let userQ = '';
async function vUsers() {
  const d = await api('GET', '/users?q=' + encodeURIComponent(userQ));
  render(`
    <div class="card">
      <h2>用户管理</h2>
      <div class="toolbar">
        <input id="user-q" placeholder="搜索邮箱/昵称" value="${esc(userQ)}" onkeydown="if(event.key==='Enter'){userQ=this.value;vUsers()}">
        <button class="primary" onclick="userQ=$('#user-q').value;vUsers()">搜索</button>
      </div>
      <table>
        <tr><th>ID</th><th>昵称</th><th>邮箱</th><th>性别</th><th>学校</th><th>状态</th><th>操作</th></tr>
        ${d.list.map((u) => `<tr>
          <td>${u.id}</td><td>${esc(u.nickname)}</td><td>${esc(u.email)}</td>
          <td>${u.gender === 'male' ? '男' : '女'}</td><td>${esc(u.school)}</td>
          <td>${u.banned ? '<span class="tag red">已封禁</span>' : '<span class="tag green">正常</span>'}</td>
          <td>
            <button class="small" onclick="viewUser(${u.id})">详情</button>
            ${u.banned ? `<button class="small" onclick="banUser(${u.id},0)">解封</button>` : `<button class="small danger" onclick="banUser(${u.id},1)">封禁</button>`}
          </td></tr>`).join('')}
      </table>
    </div>`);
}
async function banUser(id, banned) {
  await api('POST', `/users/${id}/ban`, { banned });
  toast(banned ? '已封禁' : '已解封'); vUsers();
}
async function viewUser(id) {
  const d = await api('GET', `/users/${id}`);
  const u = d.user;
  render(`
    <div class="card">
      <div class="toolbar"><h2 style="margin:0">用户 #${u.id} ${esc(u.nickname)}</h2><div class="spacer"></div>
        <button class="ghost" onclick="vUsers()">返回</button></div>
      <table>
        <tr><td>邮箱</td><td>${esc(u.email)}</td><td>性别</td><td>${u.gender === 'male' ? '男' : '女'}</td></tr>
        <tr><td>邀请码</td><td>${esc(u.invite_code)}</td><td>被邀请人</td><td>${u.invited_by || '无'}</td></tr>
        <tr><td>注册时间</td><td>${esc(u.created_at)}</td><td>学校</td><td>${esc(u.school || '-')}</td></tr>
      </table>
    </div>`);
}

// ---------- 书市书籍管理 ----------
const BOOK_ST_CN = { on: ['在售', 'green'], off: ['已下架', ''], sold: ['已售出', 'blue'] };
let bookSt = '';
let bookQ = '';
async function vBooks() {
  const d = await api('GET', '/books?status=' + bookSt + '&q=' + encodeURIComponent(bookQ));
  const rowBtn = (b) => {
    const mk = (st, lbl, cls) => `<button class="small ${cls}" onclick="bookSetStatus(${b.id},'${st}')">${lbl}</button>`;
    if (b.status === 'on') return mk('off', '下架', '') + mk('sold', '标记已售', 'danger');
    if (b.status === 'off') return mk('on', '重新上架', '') + mk('sold', '标记已售', 'danger');
    return mk('on', '重新上架', '');
  };
  render(`
    <div class="card">
      <h2>书市书籍（平台仅展示信息与促成联系，不参与线下交易）</h2>
      <div class="toolbar">
        <select id="book-st" onchange="bookSt=this.value;vBooks()">
          <option value="" ${bookSt === '' ? 'selected' : ''}>全部状态</option>
          <option value="on" ${bookSt === 'on' ? 'selected' : ''}>在售</option>
          <option value="off" ${bookSt === 'off' ? 'selected' : ''}>已下架</option>
          <option value="sold" ${bookSt === 'sold' ? 'selected' : ''}>已售出</option>
        </select>
        <input id="book-q" placeholder="搜索书名/卖家昵称" value="${esc(bookQ)}" onkeydown="if(event.key==='Enter'){bookQ=this.value;vBooks()}">
        <button class="primary" onclick="bookQ=$('#book-q').value;vBooks()">搜索</button>
      </div>
      <table>
        <tr><th>ID</th><th>书名</th><th>课程</th><th>成色</th><th>价格</th><th>卖家</th><th>学校</th><th>举报</th><th>状态</th><th>操作</th></tr>
        ${d.list.map((b) => `<tr>
          <td>${b.id}</td>
          <td><b>${esc(b.title)}</b>${b.note ? `<div class="sub">${esc(b.note)}</div>` : ''}</td>
          <td>${esc(b.course || '-')}</td>
          <td>${esc(b.cond_cn || '-')}</td>
          <td>${b.price_cents > 0 ? '<b>¥' + yuan(b.price_cents) + '</b>' : esc(b.price_note || '面议')}</td>
          <td>${esc(b.seller_name)}<div class="sub">${esc(b.seller_email || '')}</div></td>
          <td>${esc(b.school_name || '-')}</td>
          <td>${b.open_reports > 0 ? `<span class="tag red">${b.open_reports} 条待处理</span>` : '0'}</td>
          <td>${(() => { const [t, c] = BOOK_ST_CN[b.status] || [b.status, '']; return `<span class="tag ${c}">${t}</span>`; })()}</td>
          <td>${rowBtn(b)}</td></tr>`).join('')}
      </table>
    </div>`);
}
async function bookSetStatus(id, st) {
  await api('POST', `/books/${id}/status`, { status: st });
  toast('已更新'); vBooks();
}

// ---------- 书市举报处理 ----------
async function vBookReports() {
  const d = await api('GET', '/book-reports');
  refreshBadges();
  render(`
    <div class="card">
      <h2>书市举报（虚假信息/盗版/非本校人员等）</h2>
      <table>
        <tr><th>ID</th><th>书籍</th><th>举报人</th><th>卖家</th><th>原因</th><th>时间</th><th>状态</th><th>处理说明</th><th>操作</th></tr>
        ${d.list.map((r) => `<tr>
          <td>${r.id}</td><td>${esc(r.title)}</td><td>${esc(r.reporter_name)}</td><td>${esc(r.seller_name)}</td>
          <td>${esc(r.reason)}</td><td>${fmt(r.created_at)}</td>
          <td>${r.status === 'open' ? '<span class="tag red">待处理</span>' : '<span class="tag green">已处理</span>'}</td>
          <td>${esc(r.note || '-')}</td>
          <td>${r.status === 'open' ? '<button class="small primary" onclick="resolveBookReport(' + r.id + ')">处理</button>' : ''}</td></tr>`).join('')}
      </table>
    </div>`);
}
async function resolveBookReport(id) {
  const note = prompt('处理说明（必填）：例如 已核实下架该书籍并警告卖家');
  if (note === null) return;
  if (!note.trim()) return toast('请填写处理说明');
  await api('POST', `/book-reports/${id}/resolve`, { note: note.trim() });
  toast('已处理'); vBookReports();
}

// ---------- 版本管理 ----------
async function vVersion() {
  const d = await api('GET', '/settings');
  const s = d.settings;
  render(`
    <div class="card">
      <h2>版本管理</h2>
      <p style="color:#7a8088;font-size:12px;margin-top:-6px">
        发布规则：App 会拿「新版本号」和自己内置的版本号比较，<b>服务器版本号更大才会提示更新</b>；
        App 低于「最低可用版本号」时强制更新（不可跳过）。发布后用户端重启立即收到提示，长期在线的最迟 6 小时内收到。
      </p>
      <table>
        <tr><td>新版本号</td><td><input id="v-code" type="number" value="${s.version_code || 0}"> <span style="color:#7a8088;font-size:12px">当前已发布：${s.version_code || 0}，新值必须更大</span></td></tr>
        <tr><td>最低可用版本号</td><td><input id="v-min" type="number" value="${s.min_version_code || 0}"> <span style="color:#7a8088;font-size:12px">低于此值强制更新，0 = 不强制</span></td></tr>
        <tr><td>更新说明</td><td><input id="v-note" value="${esc(s.version_note || '')}" style="width:400px" placeholder="展示给用户，例如：修复若干问题，优化体验"></td></tr>
        <tr><td>APK 地址</td><td><input id="v-url" value="${esc(s.apk_url || '')}" style="width:400px" placeholder="/files/apk/lele-book.apk 或完整外链 https://..."></td></tr>
        <tr><td>本次更新强制</td><td><select id="v-forced"><option value="0" ${s.version_forced !== '1' ? 'selected' : ''}>否</option><option value="1" ${s.version_forced === '1' ? 'selected' : ''}>是</option></select></td></tr>
      </table>
      <div class="toolbar" style="margin-top:14px">
        <input id="v-file" type="file" accept=".apk">
        <button class="primary" id="v-upload-btn" onclick="uploadApk()">上传 APK 并发布</button>
        <button class="ghost" id="v-save-btn" onclick="saveVersion()">仅保存版本信息</button>
      </div>
      <p id="v-status" style="color:#7a8088;font-size:12px">上传 APK 会自动把地址置为 /files/apk/lele-book.apk，并按上方填写的版本号一键发布。</p>
      <p style="background:#e6f5ee;border-radius:8px;padding:10px 12px;font-size:13px;color:#0f8a5f">
        📢 推广下载地址（海报二维码用，永久有效，始终指向最新发布的版本）：
        <a id="promo-url" style="font-weight:700"></a>
        （二维码请对以下文本框内容生成）
        <input id="promo-url-text" readonly style="width:280px;border:1px solid #dfe3e6;border-radius:6px;padding:4px 8px">
      </p>
    </div>`);
}
  // 推广下载地址（落地页 /d，随管理后台访问地址自适应）
  const promo = location.origin + '/d';
  const pu = $('#promo-url'), put = $('#promo-url-text');
  if (pu) { pu.textContent = promo; pu.href = promo; }
  if (put) put.value = promo;

function vStatus(msg, warn) {
  const el = $('#v-status');
  if (el) { el.textContent = msg; el.style.color = warn ? '#c0392b' : '#7a8088'; }
}
async function uploadApk() {
  const f = $('#v-file').files[0];
  if (!f) return toast('请先选择 APK 文件');
  if (!(+$('#v-code').value > 0)) return toast('请先填写新版本号（须大于线上 App 的版本号，用户端才会提示更新）');
  const btn = $('#v-upload-btn'), save = $('#v-save-btn');
  btn.disabled = true; save.disabled = true;
  vStatus(`正在上传 ${f.name}（${(f.size / 1048576).toFixed(1)} MB）… APK 较大，请勿关闭页面`);
  try {
    const fd = new FormData();
    fd.append('file', f);
    const r = await fetch('/api/admin/apk', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: fd });
    const j = await r.json();
    if (!j.ok) { vStatus('上传失败：' + (j.error?.msg || '未知错误'), true); toast('上传失败'); return; }
    vStatus('APK 上传完成，正在保存发布信息…');
    await saveVersion(true);
  } catch (e) {
    vStatus('上传失败：' + e, true);
    toast('上传失败');
  } finally {
    btn.disabled = false; save.disabled = false;
  }
}
async function saveVersion(skip) {
  const code = +$('#v-code').value;
  if (!(code > 0)) { toast('版本号需大于 0'); return; }
  const url = $('#v-url').value.trim();
  if (!url && !skip) { toast('尚未填写 APK 地址：用户端将无法下载，请上传 APK 或填写完整外链'); return; }
  const body = {
    version_code: code,
    min_version_code: +$('#v-min').value,
    apk_url: url,
    version_note: $('#v-note').value.trim(),
    forced: $('#v-forced').value === '1',
  };
  if (skip) body.apk_url = '';
  try {
    await api('PUT', '/version', body);
    toast(skip === true ? `发布成功！v${code} 已生效${body.forced ? '（强制更新）' : ''}，用户端重启或 6 小时内会收到提示` : '版本信息已保存');
  } catch (e) {
    toast('保存失败：' + (e?.message || e));
  }
  vVersion();
}

// ---------- 初始化 ----------
$('#login-btn').addEventListener('click', doLogin);
$('#login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
$('#logout-btn').addEventListener('click', () => { TOKEN = ''; localStorage.removeItem('lele_admin_token'); showLogin(); });
$$('#sidebar nav a').forEach((a) => a.addEventListener('click', () => go(a.dataset.view)));

function goLogin() {
  showLogin();
}
if (TOKEN) {
  $('#login-box').classList.add('hidden');
  $('#app').classList.remove('hidden');
  go('dashboard');
} else {
  goLogin();
}

// 乐乐书市 服务端入口（纯二手书市版）
const path = require('path');
const http = require('http');
const express = require('express');
const { cfg } = require('./config');
const { initWs } = require('./ws');
const { ok } = require('./util');

require('./db'); // 初始化数据库

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.json({ limit: '128kb' }));

// 静态资源：头像 / 书籍封面（APK 不允许公开直链下载，见下方 /dl/apk）
// 拦截必须放在 express.static 之前，否则静态服务会先命中并直接回包
app.use('/files/apk', (req, res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', msg: '接口不存在' } }));
app.use('/files', express.static(path.join(__dirname, '..', 'uploads'), { maxAge: '1d' }));
// 签名下载入口：/dl/apk?e=<过期时间ms>&k=<hmac>（10 分钟内有效，由 /api/apk-dl-url 签发）
app.get('/dl/apk', (req, res) => {
  const e = parseInt(req.query.e, 10);
  const k = String(req.query.k || '');
  const crypto = require('crypto');
  const fs = require('fs');
  const expect = crypto.createHmac('sha256', cfg.jwt_secret).update(`apk|${e}`).digest('hex');
  const apkPath = path.join(__dirname, '..', 'uploads', 'apk', 'lele-book.apk');
  if (!Number.isFinite(e) || e < Date.now() || k !== expect) {
    return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', msg: '下载链接已失效，请在 App 内重新获取' } });
  }
  if (!fs.existsSync(apkPath)) {
    return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', msg: 'APK 尚未上传，请在管理后台发布' } });
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="lele-book.apk"');
  res.sendFile(apkPath);
});

// ---------- 永久推广下载（海报二维码用） ----------
// /d   落地页：展示当前版本与说明 + 下载按钮（二维码指向这里，之后换域名/端口只需改落地页跳转）
// /dl/latest  直连：始终返回管理后台最新发布的 APK；不登录、签名永久有效，
//             配简单限流防 bandwidth 被刷（校园推广场景，正常扫码人群互不影响）
const { makeLimiter } = require('./util');
const apkDlLimiter = makeLimiter(60 * 60 * 1000, 20); // 单 IP 每小时 20 次
app.get('/dl/latest', (req, res) => {
  const fs = require('fs');
  const apkPath = path.join(__dirname, '..', 'uploads', 'apk', 'lele-book.apk');
  if (!fs.existsSync(apkPath)) {
    return res.status(404).send('<meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding-top:20vh"><h2>APK 尚未发布</h2><p>请在管理后台上传 APK 并发布</p></body>');
  }
  if (!apkDlLimiter.check(`dl:${req.ip}`).ok) {
    return res.status(429).send('<meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding-top:20vh"><h2>下载太频繁啦</h2><p>请一小时后再试；如果你是正常扫码下载，一般不会碰到这条提示</p></body>');
  }
  const { getSettings } = require('./db');
  const code = getSettings().version_code || 0;
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', `attachment; filename="lele-book-v${code}.apk"`);
  res.sendFile(apkPath);
});
// 推广物料：落地页引用的 App 图标与邀请海报（随代码分发）
app.get('/appicon.png', (req, res) => res.sendFile(path.join(__dirname, 'appicon.png')));
app.get('/poster.png', (req, res) => res.sendFile(path.join(__dirname, 'poster.png')));

app.get('/d', (req, res) => {
  const { getSettings } = require('./db');
  const s = getSettings();
  const hasApk = require('fs').existsSync(path.join(__dirname, '..', 'uploads', 'apk', 'lele-book.apk'));
  const note = String(s.version_note || '').trim();
  res.send(`<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>乐乐书市 · App 下载</title>
<style>
  body{margin:0;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
    background:linear-gradient(180deg,#0f8a5f 0%,#16a06f 30%,#f4f6f7 30.1%);min-height:100vh;text-align:center}
  .wrap{max-width:420px;margin:0 auto;padding:48px 24px 40px}
  .logo{width:76px;height:76px;border-radius:20px;object-fit:cover;box-shadow:0 6px 18px rgba(0,0,0,.18)}
  h1{color:#fff;font-size:26px;margin:14px 0 4px;letter-spacing:1px}
  .sub{color:rgba(255,255,255,.85);font-size:13px;margin-bottom:26px}
  .card{background:#fff;border-radius:16px;padding:22px 18px;box-shadow:0 8px 24px rgba(0,0,0,.08)}
  .ver{display:inline-block;background:#e6f5ee;color:#0f8a5f;border-radius:12px;padding:4px 12px;
    font-size:13px;font-weight:600}
  .note{color:#5a6570;font-size:13px;line-height:1.7;margin:12px 0 18px;white-space:pre-line}
  a.btn{display:block;background:linear-gradient(135deg,#12a06d,#0d8a5f);color:#fff;text-decoration:none;
    border-radius:14px;padding:14px 0;font-size:17px;font-weight:700;box-shadow:0 6px 16px rgba(15,138,95,.35)}
  .hint{color:#98a1a8;font-size:12px;line-height:1.7;margin-top:14px;text-align:left}
  .foot{color:#a8b0b6;font-size:11px;margin-top:22px;line-height:1.7}
</style></head><body>
<div class="wrap">
  <img class="logo" src="/appicon.png" alt="乐乐书市">
  <h1>乐乐书市</h1>
  <div class="sub">校园二手书市 · 好书流转一个学期</div>
  <div class="card">
    ${hasApk ? `<span class="ver">最新版本 v${s.version_code || '?'}</span>
    ${note ? `<div class="note">${note.replace(/</g, '&lt;')}</div>` : ''}
    <a class="btn" href="/dl/latest" download>下载 Android 安装包</a>
    <div class="hint">· 下载完成后点击安装包，若系统提示「禁止安装未知应用」，请按提示允许后重试<br>· 注册需邮箱验证码，验证码邮件可能进入垃圾箱<br>· 仅支持 Android，微信内扫码请点右上角「在浏览器打开」</div>`
    : `<span class="ver">安装包准备中</span><div class="note">APK 尚未发布，请稍后再试</div>`}
  </div>
  <div class="foot">本平台仅提供信息撮合与技术支持，线下交易请当面验视、当面结算。<br>严禁利用本平台进行违反校规校纪的行为。</div>
</div>
</body></html>`);
});
// 管理后台网页
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

// 健康检查
app.get('/api/ping', (req, res) => ok(res, { time: Date.now(), tz: 'UTC+8', dev: cfg.dev_mode }));

// 路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/book-chats', require('./routes/bookchats'));
app.use('/api/books', require('./routes/books'));
app.use('/api/invite', require('./routes/invite'));
app.use('/api', require('./routes/misc'));
app.use('/api/admin', require('./routes/admin'));

// 404 & 错误兜底
app.use((req, res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', msg: '接口不存在' } }));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('[error]', err.message);
  res.status(500).json({ ok: false, error: { code: 'SERVER_ERROR', msg: '服务器开小差了，请稍后重试' } });
});

const server = http.createServer(app);
// Node 18+ 默认 requestTimeout=300s：服务器带宽小时上传几百 MB 的 APK 会被中途掐断
// （管理后台表现为 TypeError: Failed to fetch）。关闭总超时，仅保留头部/保活超时。
server.requestTimeout = 0;
server.headersTimeout = 60 * 1000;
server.keepAliveTimeout = 75 * 1000;
initWs(server);

server.listen(cfg.port, cfg.host, () => {
  console.log('==========================================');
  console.log(' 乐乐书市服务端已启动');
  console.log(` 地址: http://${cfg.host}:${cfg.port}`);
  console.log(` 管理后台: http://服务器IP:${cfg.port}/admin`);
  console.log(` 开发模式: ${cfg.dev_mode ? '开（验证码会打印在控制台）' : '关'}`);
  if (!cfg.smtp || !cfg.smtp.host) console.log(' 提醒: 尚未配置 SMTP，验证码不会真正发送邮件，只会打印在控制台');
  if (cfg.jwt_secret.startsWith('请修改')) console.log(' 警告: jwt_secret 还是默认占位符，正式上线前请修改 config.json');
  console.log('==========================================');
});

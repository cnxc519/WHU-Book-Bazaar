// 通用：学校、版本、通知、用户主页
const express = require('express');
const { db, getSettings } = require('../db');
const { requireUser } = require('../auth');
const { ok, clampInt } = require('../util');
const { userPublic } = require('../business');
const { cfg } = require('../config');

const router = express.Router();

// 学校列表（注册前需要，公开）
router.get('/schools', (req, res) => {
  const list = db.prepare(`SELECT * FROM schools ORDER BY id`).all().map((s) => ({ id: s.id, name: s.name }));
  ok(res, { list });
});

// 版本检查（公开）：code 当前版本号, min 最低可用版本号（低于则强制更新）, forced 本次是否为强制更新
router.get('/version', (req, res) => {
  const s = getSettings();
  ok(res, {
    code: s.version_code || 0,
    min: s.min_version_code || 0,
    url: s.apk_url || '',
    note: s.version_note || '',
    forced: (s.version_forced || 0) === 1,
    // 永久推广下载页（海报二维码同款地址）：应用内安装失败转浏览器下载时用，
    // 不再把带 IP:端口的签名直链暴露给用户
    dl_page: s.dl_page_url || 'https://lele.this-is-my.world/d',
  });
});

// APK 一次性下载链接（10 分钟有效）：避免 /files/apk 公开直链暴露服务器入口。
// 链接形如 /dl/apk?e=<过期ms>&k=<hmac(jwt_secret, "apk|e")>，过期或篡改即 404
router.get('/apk-dl-url', requireUser, (req, res) => {
  const crypto = require('crypto');
  const { cfg } = require('../config');
  const e = Date.now() + 10 * 60 * 1000;
  const k = crypto.createHmac('sha256', cfg.jwt_secret).update(`apk|${e}`).digest('hex');
  ok(res, { url: `/dl/apk?e=${e}&k=${k}`, expires_in: 600 });
});

router.get('/notifications', requireUser, (req, res) => {
  const page = clampInt(req.query.page, 1, 1000, 1);
  const unread = db.prepare(`SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0`).get(req.user.id).c;
  const list = db.prepare(`SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50 OFFSET ?`)
    .all(req.user.id, (page - 1) * 50);
  ok(res, { unread, list });
});

router.post('/notifications/read', requireUser, (req, res) => {
  const id = parseInt(req.body.id, 10);
  if (id) db.prepare(`UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?`).run(id, req.user.id);
  else db.prepare(`UPDATE notifications SET is_read=1 WHERE user_id=?`).run(req.user.id);
  ok(res, { ok: true });
});

// 用户主页（书市聊天/书籍详情可点进查看卖家信息）
router.get('/users/:id/profile', requireUser, (req, res) => {
  const u = db.prepare(`SELECT * FROM users WHERE id=? AND id!=0`).get(parseInt(req.params.id, 10));
  if (!u) return ok(res, { user: null });
  // 二手书市：在售/已售出统计 + 最近在售（最多 3 本，点击可进书详情）
  const booksOn = db.prepare(`SELECT COUNT(*) c FROM books WHERE seller_id=? AND status='on'`).get(u.id).c;
  const booksSold = db.prepare(`SELECT COUNT(*) c FROM books WHERE seller_id=? AND status='sold'`).get(u.id).c;
  const books = db.prepare(`SELECT id,title,price_cents,price_note,cond,photo,status FROM books WHERE seller_id=? AND status='on' ORDER BY id DESC LIMIT 3`).all(u.id);
  ok(res, {
    user: {
      ...userPublic(u),
      books_on: booksOn, books_sold: booksSold, books,
    }
  });
});

// 公告列表（书市横幅 + 公告中心）
router.get('/notices', requireUser, (req, res) => {
  const list = db.prepare(`SELECT * FROM notices WHERE status='active' ORDER BY id DESC LIMIT 20`).all();
  ok(res, { list });
});

module.exports = router;

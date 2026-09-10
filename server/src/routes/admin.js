// 管理后台 API（web 管理端使用）—— 无支付版本
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { db, getSettings, setSetting } = require('../db');
const { cfg } = require('../config');
const { signAdminToken, requireAdmin } = require('../auth');
const { ok, fail, clampInt, nowTs } = require('../util');
const { makeLimiter } = require('../util');

const router = express.Router();
const limAdmin = makeLimiter(10 * 60 * 1000, 10);

const SETTING_KEYS = ['avatar_max_kb'];

router.post('/login', (req, res) => {
  const u = String(req.body.username || '');
  const p = String(req.body.password || '');
  const lr = limAdmin.check(`admin:${req.ip}`);
  if (!lr.ok) return fail(res, '尝试次数过多，请稍后再试');
  if (u !== cfg.admin.username || !bcrypt.compareSync(p, cfg.adminHash)) return fail(res, '账号或密码错误');
  ok(res, { token: signAdminToken() });
});

router.use(requireAdmin);

router.get('/dashboard', (req, res) => {
  ok(res, {
    users: db.prepare(`SELECT COUNT(*) c FROM users WHERE id!=0`).get().c,
    books_on: db.prepare(`SELECT COUNT(*) c FROM books WHERE status='on'`).get().c,
    open_book_reports: db.prepare(`SELECT COUNT(*) c FROM book_reports WHERE status='open'`).get().c,
    settings: getSettings(),
  });
});

// ---------- 规则设置（读取/保存流程参数） ----------
router.get('/settings', (req, res) => ok(res, { settings: getSettings() }));
router.put('/settings', (req, res) => {
  for (const k of SETTING_KEYS) {
    const v = parseInt(req.body[k], 10);
    if (Number.isFinite(v) && v > 0) setSetting(k, clampInt(v, 1, 100000, getSettings()[k] || 1));
  }
  ok(res, { settings: getSettings() });
});

// ---------- 学校管理 ----------
router.get('/schools', (req, res) => {
  const list = db.prepare(`SELECT s.* FROM schools s ORDER BY s.id`).all();
  ok(res, { list });
});
router.post('/schools', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (name.length < 2 || name.length > 30) return fail(res, '学校名称需为 2-30 字');
  if (db.prepare(`SELECT id FROM schools WHERE name=?`).get(name)) return fail(res, '该校已存在');
  const r = db.prepare(`INSERT INTO schools(name) VALUES(?)`).run(name);
  ok(res, { id: r.lastInsertRowid });
});


router.get('/notices', (req, res) => {
  const list = db.prepare(`SELECT * FROM notices ORDER BY id DESC LIMIT 100`).all();
  ok(res, { list });
});
router.post('/notices', (req, res) => {
  const title = String(req.body.title || '').trim();
  const content = String(req.body.content || '').trim();
  if (!title || title.length > 50) return fail(res, '公告标题 1-50 字');
  if (!content || content.length > 2000) return fail(res, '公告内容 1-2000 字');
  const r = db.prepare(`INSERT INTO notices(title,content,created_at) VALUES(?,?,?)`).run(title, content, nowTs());
  ok(res, { id: r.lastInsertRowid });
});
router.put('/notices/:id', (req, res) => {
  const n = db.prepare(`SELECT id FROM notices WHERE id=?`).get(parseInt(req.params.id, 10));
  if (!n) return fail(res, '公告不存在', 404, 'NOT_FOUND');
  if (req.body.status !== undefined) {
    if (!['active', 'offline'].includes(req.body.status)) return fail(res, '状态不正确');
    db.prepare(`UPDATE notices SET status=? WHERE id=?`).run(req.body.status, n.id);
  }
  if (req.body.title !== undefined || req.body.content !== undefined) {
    const title = String(req.body.title ?? '').trim();
    const content = String(req.body.content ?? '').trim();
    if (!title || title.length > 50 || !content || content.length > 2000) return fail(res, '标题或内容不合法');
    db.prepare(`UPDATE notices SET title=?, content=? WHERE id=?`).run(title, content, n.id);
  }
  ok(res, { ok: true });
});
router.delete('/notices/:id', (req, res) => {
  db.prepare(`DELETE FROM notices WHERE id=?`).run(parseInt(req.params.id, 10));
  ok(res, { ok: true });
});


router.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim();
  const page = clampInt(req.query.page, 1, 1000, 1);
  const like = `%${q}%`;
  const where = q ? `WHERE (u.email LIKE ? OR u.nickname LIKE ?)` : `WHERE 1=1`;
  const params = q ? [like, like, (page - 1) * 30] : [(page - 1) * 30];
  const list = db.prepare(`
      SELECT u.id,u.email,u.nickname,u.gender,u.banned,u.avatar,u.created_at,
        s.name school, u.invited_by
      FROM users u LEFT JOIN schools s ON s.id=u.school_id ${where} ORDER BY u.id DESC LIMIT 30 OFFSET ?`).all(...params);
  ok(res, { list });
});
router.get('/users/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = db.prepare(`SELECT * FROM users WHERE id=?`).get(id);
  if (!user) return fail(res, '用户不存在', 404, 'NOT_FOUND');
  ok(res, { user });
});
router.post('/users/:id/ban', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === 0) return fail(res, '不能操作平台账号');
  db.prepare(`UPDATE users SET banned=? WHERE id=?`).run(req.body.banned ? 1 : 0, id);
  ok(res, { ok: true });
});

// ---------- 书市书籍管理 ----------
const BOOK_ST = { on: ['在售', 'green'], off: ['已下架', ''], sold: ['已售出', 'blue'] };
router.get('/books', (req, res) => {
  const st = ['on', 'off', 'sold'].includes(req.query.status) ? req.query.status : '';
  const q = String(req.query.q || '').trim();
  const where = [];
  const params = [];
  if (st) { where.push(`b.status=?`); params.push(st); }
  if (q) { where.push(`(b.title LIKE ? OR u.nickname LIKE ?)`); const like = `%${q}%`; params.push(like, like); }
  const sql = `SELECT b.*, u.nickname seller_name, u.email seller_email, s.name school_name
      FROM books b JOIN users u ON u.id=b.seller_id LEFT JOIN schools s ON s.id=u.school_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY b.id DESC LIMIT 100`;
  const list = db.prepare(sql).all(...params).map((b) => ({
    ...b,
    status_cn: BOOK_ST[b.status] ? BOOK_ST[b.status][0] : b.status,
    cond_cn: b.cond ? ({ 1: '全新未使用', 2: '几乎全新', 3: '有笔记划线', 4: '使用痕迹较多' })[b.cond] || '' : '',
    open_reports: db.prepare(`SELECT COUNT(*) c FROM book_reports WHERE book_id=? AND status='open'`).get(b.id).c,
  }));
  ok(res, { list });
});
router.post('/books/:id/status', (req, res) => {
  const b = db.prepare(`SELECT id FROM books WHERE id=?`).get(parseInt(req.params.id, 10));
  if (!b) return fail(res, '书籍不存在', 404, 'NOT_FOUND');
  const st = req.body.status;
  if (!['on', 'off', 'sold'].includes(st)) return fail(res, '状态不正确');
  db.prepare(`UPDATE books SET status=? WHERE id=?`).run(st, b.id);
  ok(res, { ok: true, status: st });
});

// ---------- 书市举报处理 ----------
router.get('/book-reports', (req, res) => {
  const list = db.prepare(`
      SELECT rp.*, COALESCE(b.title, '（书籍已删除）') title, u1.nickname reporter_name, u2.nickname seller_name
      FROM book_reports rp LEFT JOIN books b ON b.id=rp.book_id
      LEFT JOIN users u1 ON u1.id=rp.reporter_id LEFT JOIN users u2 ON u2.id=b.seller_id
      ORDER BY rp.status='open' DESC, rp.id DESC LIMIT 100`).all();
  ok(res, { list });
});
router.post('/book-reports/:id/resolve', (req, res) => {
  const rp = db.prepare(`SELECT * FROM book_reports WHERE id=? AND status='open'`).get(parseInt(req.params.id, 10));
  if (!rp) return fail(res, '举报不存在或已处理');
  const note = String(req.body.note || '').trim();
  if (note.length < 1) return fail(res, '请填写处理说明');
  db.prepare(`UPDATE book_reports SET status='resolved', note=? WHERE id=?`).run(note, rp.id);
  ok(res, { ok: true });
});


router.put('/version', (req, res) => {
  const s = getSettings();
  const set = (k, def) => setSetting(k, clampInt(req.body[k], 0, 1000000, def));
  set('version_code', s.version_code || 0);
  set('min_version_code', s.min_version_code || 0);
  set('version_forced', 0);
  setSetting('apk_url', String(req.body.apk_url || s.apk_url || ''));
  setSetting('version_note', String(req.body.version_note || '').slice(0, 500));
  if (req.body.forced === true || req.body.forced === 'true') setSetting('version_forced', '1');
  ok(res, { settings: getSettings() });
});

const apkStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'uploads', 'apk');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, 'lele-book.apk'),
});
const apkUpload = multer({ storage: apkStorage, limits: { fileSize: 300 * 1024 * 1024 } });
router.post('/apk', (req, res) => {
  apkUpload.single('file')(req, res, (err) => {
    if (err) return fail(res, '上传失败（大小限 300MB）');
    if (!req.file) return fail(res, '请选择 APK 文件');
    setSetting('apk_url', '/files/apk/lele-book.apk');
    ok(res, { url: '/files/apk/lele-book.apk' });
  });
});

module.exports = router;

// 认证：邮箱验证码注册/登录（无密码）、个人资料、头像上传
const path = require('path');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { db, getSettings } = require('../db');
const { sendCode, verifyCode } = require('../mailer');
const { signUserToken, requireUser } = require('../auth');
const { cfg } = require('../config');
const { gradeWindow } = require('../business');
const { ok, fail, isEmail, inviteCode, makeLimiter, cleanupLimiter, nowTs } = require('../util');
const { pushToUser } = require('../ws');

const router = express.Router();

const limSend = makeLimiter(60 * 1000, 1);
const limLogin = makeLimiter(10 * 60 * 1000, 5);

setInterval(() => { cleanupLimiter(limSend); cleanupLimiter(limLogin); }, 3600e3);

// 发送验证码
router.post('/send-code', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const purpose = req.body.purpose === 'login' ? 'login' : 'register';
  if (!isEmail(email)) return fail(res, '邮箱格式不正确');
  const r = limSend.check(`send:${req.ip}:${email}`);
  if (!r.ok) return fail(res, '发送过于频繁，请 60 秒后再试');
  try {
    const out = await sendCode(email, purpose);
    if (!out.ok) return fail(res, out.msg);
    ok(res, { msg: out.msg, dev_code: out.code });
  } catch (e) {
    console.error('[auth] send-code error:', e.message);
    fail(res, '验证码发送异常，请稍后重试');
  }
});

// 注册
router.post('/register', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  const nickname = String(req.body.nickname || '').trim();
  const gender = req.body.gender === 'male' ? 'male' : req.body.gender === 'female' ? 'female' : null;
  const inv = String(req.body.invite_code || '').trim().toUpperCase();

  if (!isEmail(email)) return fail(res, '邮箱格式不正确');
  if (!gender) return fail(res, '请选择性别');
  const grade = parseInt(req.body.grade, 10);
  const gw = gradeWindow();
  if (!Number.isFinite(grade) || grade < gw.min || grade > gw.max) return fail(res, '请选择年级');
  if (nickname.length < 1 || nickname.length > 20 || /[\x00-\x1f]/.test(nickname)) return fail(res, '昵称需为 1-20 个字符');
  // 学校不传/无效时默认取唯一学校（当前只有武大，网页注册已不展示学校选择）
  let schoolId = parseInt(req.body.school_id, 10);
  if (!Number.isFinite(schoolId) || !db.prepare(`SELECT id FROM schools WHERE id=?`).get(schoolId)) {
    schoolId = (db.prepare(`SELECT id FROM schools ORDER BY id LIMIT 1`).get() || {}).id || 0;
  }
  if (!schoolId) return fail(res, '暂无可用学校，请联系管理员');
  if (db.prepare(`SELECT id FROM users WHERE email=?`).get(email)) return fail(res, '该邮箱已注册，请直接登录');

  const v = verifyCode(email, 'register', code);
  if (!v.ok) return fail(res, v.msg);

  // 邀请码（选填）
  let invitedBy = null;
  if (inv) {
    const inviter = db.prepare(`SELECT id,nickname FROM users WHERE invite_code=? AND id!=0`).get(inv);
    if (!inviter) return fail(res, '邀请码不存在');
    invitedBy = inviter.id;
  }

  let codeStr;
  do { codeStr = inviteCode(); } while (db.prepare(`SELECT id FROM users WHERE invite_code=?`).get(codeStr));

  const r = db.prepare(`INSERT INTO users(email,nickname,school_id,grade,gender,invite_code,invited_by,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(email, nickname, schoolId, grade, gender, codeStr, invitedBy, new Date().toISOString());
  const uid = r.lastInsertRowid;

  if (invitedBy) {
    db.prepare(`INSERT INTO notifications(user_id,type,title,body,created_at) VALUES(?,?,?,?,?)`)
      .run(invitedBy, 'invite_used', '邀请成功', `${nickname} 通过你的邀请码注册啦，你们现在是好友啦`, nowTs());
    pushToUser(invitedBy, { t: 'notif' });
  }

  ok(res, { token: signUserToken(uid), user: { id: uid, email, nickname, gender } });
});

// 登录（无密码，邮箱验证码）
router.post('/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  if (!isEmail(email)) return fail(res, '邮箱格式不正确');
  const user = db.prepare(`SELECT * FROM users WHERE email=?`).get(email);
  if (!user) return fail(res, '该邮箱尚未注册', 404, 'NOT_REGISTERED');
  const lr = limLogin.check(`login:${req.ip}:${email}`);
  if (!lr.ok) return fail(res, '尝试次数过多，请 10 分钟后再试');
  const v = verifyCode(email, 'login', code);
  if (!v.ok) return fail(res, v.msg);
  if (user.banned) return fail(res, '账号已被封禁', 403, 'BANNED');
  ok(res, { token: signUserToken(user.id), user: { id: user.id, email: user.email, nickname: user.nickname, gender: user.gender, avatar: user.avatar, school_id: user.school_id } });
});

// ---------- 登录/注册统一入口（网页版） ----------
// 两段式：先 check（邮箱+验证码）—— 已注册直接登录；
// 未注册返回一次性 pending 票据，补昵称/学校/性别后 complete-register 完成注册。
// 好处：验证码先发后补资料，未注册用户不用重新收码。
function signPending(email) {
  return jwt.sign({ email, role: 'pending' }, cfg.jwt_secret, { expiresIn: 10 * 60 * 1000 });
}

router.post('/login-or-register', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  if (!isEmail(email)) return fail(res, '邮箱格式不正确');
  if (!code) return fail(res, '请填写验证码');
  const lr = limLogin.check(`login:${req.ip}:${email}`);
  if (!lr.ok) return fail(res, '尝试次数过多，请 10 分钟后再试');
  const v = verifyCode(email, 'login', code);
  if (!v.ok) return fail(res, v.msg);
  const user = db.prepare(`SELECT * FROM users WHERE email=?`).get(email);
  if (user) {
    if (user.banned) return fail(res, '账号已被封禁', 403, 'BANNED');
    return ok(res, {
      registered: true,
      token: signUserToken(user.id),
      user: { id: user.id, email: user.email, nickname: user.nickname, gender: user.gender, avatar: user.avatar, school_id: user.school_id },
    });
  }
  ok(res, { registered: false, pending: signPending(email) });
});

router.post('/complete-register', (req, res) => {
  let email = '';
  try {
    const p = jwt.verify(String(req.body.pending || ''), cfg.jwt_secret);
    if (p.role !== 'pending') throw new Error('bad role');
    email = String(p.email || '').toLowerCase();
  } catch {
    return fail(res, '注册会话已过期，请重新获取验证码');
  }
  const existed = db.prepare(`SELECT id FROM users WHERE email=?`).get(email);
  if (existed) return ok(res, { already: true, token: signUserToken(existed.id) });
  const nickname = String(req.body.nickname || '').trim();
  const gender = req.body.gender === 'male' ? 'male' : req.body.gender === 'female' ? 'female' : null;
  const inv = String(req.body.invite || '').trim().toUpperCase();
  if (nickname.length < 1 || nickname.length > 20) return fail(res, '昵称需为 1-20 个字符');
  // 学校不传/无效时默认取唯一学校（当前只有武大，网页注册已不展示学校选择）
  let schoolId = parseInt(req.body.school_id, 10);
  if (!Number.isFinite(schoolId) || !db.prepare(`SELECT id FROM schools WHERE id=?`).get(schoolId)) {
    schoolId = (db.prepare(`SELECT id FROM schools ORDER BY id LIMIT 1`).get() || {}).id || 0;
  }
  if (!schoolId) return fail(res, '暂无可用学校，请联系管理员');
  if (!gender) return fail(res, '请选择性别');
  const grade = parseInt(req.body.grade, 10);
  const gw = gradeWindow();
  if (!Number.isFinite(grade) || grade < gw.min || grade > gw.max) return fail(res, '请选择年级');
  let invitedBy = null;
  if (inv) {
    const inviter = db.prepare(`SELECT id,nickname FROM users WHERE invite_code=? AND id!=0`).get(inv);
    if (!inviter) return fail(res, '邀请码不存在');
    invitedBy = inviter.id;
  }
  let codeStr;
  do { codeStr = inviteCode(); } while (db.prepare(`SELECT id FROM users WHERE invite_code=?`).get(codeStr));
  const r = db.prepare(`INSERT INTO users(email,nickname,school_id,grade,gender,invite_code,invited_by,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(email, nickname, schoolId, grade, gender, codeStr, invitedBy, new Date().toISOString());
  const uid = r.lastInsertRowid;
  if (invitedBy) {
    db.prepare(`INSERT INTO notifications(user_id,type,title,body,created_at) VALUES(?,?,?,?,?)`)
      .run(invitedBy, 'invite_used', '邀请成功', `${nickname} 通过你的邀请码注册啦，你们现在是好友啦`, nowTs());
    pushToUser(invitedBy, { t: 'notif' });
  }
  ok(res, { token: signUserToken(uid), user: { id: uid, email, nickname, gender } });
});

// 当前用户信息
router.get('/me', requireUser, (req, res) => {
  const u = req.user;
  const school = db.prepare(`SELECT name FROM schools WHERE id=?`).get(u.school_id);
  ok(res, {
    id: u.id, email: u.email, nickname: u.nickname, gender: u.gender, avatar: u.avatar,
    school_id: u.school_id, school: school ? school.name : '',
    grade: u.grade, grade_cn: u.grade ? (u.grade % 100) + '级' : '',
    invited_by: u.invited_by,
    books_on: db.prepare(`SELECT COUNT(*) c FROM books WHERE seller_id=? AND status='on'`).get(u.id).c,
  });
});

// 头像上传（每人一张，用于双方相认；大小限制可配置，默认 200KB）
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'uploads', 'avatars');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${req.user.id}.jpg`),
});
const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okType = file.mimetype === 'image/jpeg' || file.mimetype === 'image/png';
    cb(okType ? null : new Error('仅支持 JPG/PNG 图片'), okType);
  },
});

router.post('/me/avatar', requireUser, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return fail(res, err.message === '仅支持 JPG/PNG 图片' ? err.message : '图片上传失败，大小请勿超过限制');
    if (!req.file) return fail(res, '请选择图片');
    const s = getSettings();
    const sizeKb = fs.statSync(req.file.path).size / 1024;
    if (sizeKb > s.avatar_max_kb) {
      fs.unlinkSync(req.file.path);
      return fail(res, `图片超过 ${s.avatar_max_kb}KB 限制，请重新选择（应用会自动压缩）`);
    }
    db.prepare(`UPDATE users SET avatar=1 WHERE id=?`).run(req.user.id);
    ok(res, { url: `/files/avatars/${req.user.id}.jpg?t=${Date.now()}` });
  });
});

module.exports = router;

// JWT 鉴权中间件
const jwt = require('jsonwebtoken');
const { cfg } = require('./config');
const { db } = require('./db');
const { fail, e401 } = require('./util');

const USER_TOKEN_TTL = '30d';
const ADMIN_TOKEN_TTL = '12h';

function signUserToken(uid) { return jwt.sign({ uid, role: 'user' }, cfg.jwt_secret, { expiresIn: USER_TOKEN_TTL }); }
function signAdminToken() { return jwt.sign({ role: 'admin' }, cfg.jwt_secret, { expiresIn: ADMIN_TOKEN_TTL }); }

function parseToken(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!t) return null;
  try { return jwt.verify(t, cfg.jwt_secret); } catch { return null; }
}

// 用户鉴权：挂载到所有 /api 业务接口
function requireUser(req, res, next) {
  const payload = parseToken(req);
  if (!payload || payload.role !== 'user' || !payload.uid) return e401(res);
  const user = db.prepare(`SELECT * FROM users WHERE id=?`).get(payload.uid);
  if (!user) return e401(res, '账号不存在');
  if (user.banned) return fail(res, '账号已被封禁', 403, 'BANNED');
  req.user = user;
  next();
}

// 管理端鉴权
function requireAdmin(req, res, next) {
  const payload = parseToken(req);
  if (!payload || payload.role !== 'admin') return fail(res, '请先登录管理后台', 401, 'UNAUTHORIZED');
  req.admin = payload;
  next();
}

module.exports = { signUserToken, signAdminToken, requireUser, requireAdmin };

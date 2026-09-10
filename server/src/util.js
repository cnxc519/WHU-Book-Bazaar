// 通用工具：时区(UTC+8)、日期、校验、响应封装
const crypto = require('crypto');

const TZ_MS = 8 * 3600 * 1000; // 全部业务按北京时间计算

function chinaNow() { return new Date(Date.now() + TZ_MS); }
function nowTs() { return Date.now(); }

// 北京时间今天的日期 YYYY-MM-DD
function todayKey() { return chinaNow().toISOString().slice(0, 10); }

// 北京日期字符串 -> 该日 00:00 的 UTC 毫秒
function dateKeyToEpoch(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - TZ_MS;
}

// UTC 毫秒 -> 北京日期字符串
function epochToDateKey(ts) {
  return new Date(ts + TZ_MS).toISOString().slice(0, 10);
}

// 北京日期 的星期几 0=周日 .. 6=周六（与 JS Date.getDay 一致）
function weekdayOfKey(key) {
  return new Date(dateKeyToEpoch(key) + TZ_MS).getUTCDay();
}

// 北京当前小时 0..23
function chinaHour() {
  return chinaNow().getUTCHours();
}

// 北京时间当前（秒级精度）
function chinaNowStr() { return chinaNow().toISOString().replace('T', ' ').slice(0, 19); }

// ---------- 响应 ----------
function ok(res, data) { res.json({ ok: true, data: data === undefined ? null : data }); }
function fail(res, msg, status = 400, code = 'BAD_REQUEST') {
  res.status(status).json({ ok: false, error: { code, msg } });
}
const e401 = (res, msg = '登录已过期，请重新登录') => fail(res, msg, 401, 'UNAUTHORIZED');
const e403 = (res, msg = '没有权限') => fail(res, msg, 403, 'FORBIDDEN');

// ---------- 校验 ----------
const isEmail = (s) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s || '');
const clampInt = (v, min, max, def) => {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
};
const isDateKey = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));

// ---------- 随机 ----------
const code6 = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆字符
function inviteCode(len = 8) {
  let s = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) s += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return s;
}

// 简单的内存限流器: limit 次 / windowMs 毫秒
function makeLimiter(windowMs, limit) {
  const m = new Map();
  return {
    m, // 必须暴露给 cleanupLimiter 遍历；此前闭包没暴露，定时清理一跑（每小时）
       // 整个进程直接 TypeError 崩掉 —— 生产上 PM2 拉起，用户侧表现为每小时闪断一次
    check(key) {
      const now = Date.now();
      const rec = m.get(key);
      if (!rec || now - rec.t0 > windowMs) { m.set(key, { t0: now, n: 1 }); return { ok: true, remain: limit - 1 }; }
      rec.n++;
      if (rec.n > limit) { m.set(key, { t0: now, n: 0 }); return { ok: false, remain: 0 }; }
      return { ok: true, remain: limit - rec.n };
    }
  };
}

// 清理由时间生成的过期数据（低配服务器上防止内存膨胀）
function cleanupLimiter(l) {
  const now = Date.now();
  for (const [k, v] of l.m) if (now - v.t0 > 3600e3) l.m.delete(k);
}

module.exports = {
  TZ_MS, chinaNow, nowTs, todayKey, dateKeyToEpoch, epochToDateKey,
  weekdayOfKey, chinaHour, chinaNowStr,
  ok, fail, e401, e403,
  isEmail, clampInt, isDateKey,
  code6, inviteCode, makeLimiter, cleanupLimiter,
};

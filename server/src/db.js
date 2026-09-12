// SQLite 数据库（Node 内置 node:sqlite，零原生依赖）：建表、种子数据、事务助手
// 要求 Node >= 22.5（建议 24 LTS）。better-sqlite3 的兼容写法。
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { DEFAULTS } = require('./config');

const db = new DatabaseSync(path.join(__dirname, '..', 'data.db'));

// 历史"已售出"书籍清理：现行为标记售出即删除，旧版本只改 status='sold'，
// 启动时统一清掉残留的书行与封面文件，并关闭其会话
try {
  const soldRows = db.prepare(`SELECT id FROM books WHERE status='sold'`).all();
  if (soldRows.length) {
    for (const r of soldRows) {
      try { fs.unlinkSync(path.join(__dirname, '..', 'uploads', 'books', r.id + '.jpg')); } catch (e) {}
    }
    db.prepare(`DELETE FROM books WHERE status='sold'`).run();
    db.prepare(`UPDATE book_chats SET closed=1 WHERE book_id NOT IN (SELECT id FROM books)`).run();
    console.log('[migrate] 已清理历史已售出书籍', soldRows.length, '本');
  }
} catch (e) { console.log('[migrate] 已售出书籍清理失败:', e.message); }

// 老库迁移：book_chats 增加会话关闭标记列（标记售出即删时关闭会话用）。
// 9 月初创建的生产库没有该列，导致"标记已售出"报"服务器开小差"但书已删除。
// 新库建表已含该列；全新空库此刻表还没建，靠 try/catch 跳过（建表语句自带 closed）
try {
  const chatCols0 = db.prepare(`PRAGMA table_info(book_chats)`).all().map((c) => c.name);
  if (chatCols0.length && !chatCols0.includes('closed')) {
    db.exec(`ALTER TABLE book_chats ADD COLUMN closed INTEGER NOT NULL DEFAULT 0`);
    console.log('[migrate] book_chats 表已增加 closed 列');
  }
} catch (e) { console.log('[migrate] book_chats closed 列检查失败:', e.message); }
db.exec('PRAGMA journal_mode=WAL');
db.exec('PRAGMA foreign_keys=ON');

// 事务助手：BEGIN IMMEDIATE ... COMMIT / ROLLBACK（支持嵌套场景请在业务层避免嵌套调用）
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    throw e;
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  nickname TEXT NOT NULL,
  school_id INTEGER NOT NULL DEFAULT 0,
  grade INTEGER NOT NULL DEFAULT 0,  -- 年级（入学年份，如 2025 = 25级；0 为迁移前的旧行，启动时统一补齐）
  gender TEXT NOT NULL DEFAULT 'female' CHECK(gender IN ('male','female')),
  invite_code TEXT UNIQUE NOT NULL,
  invited_by INTEGER,
  avatar INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_codes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS schools(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT,
  body TEXT,
  data_json TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings(
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notices(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS books(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL,
  title TEXT NOT NULL,               -- 书名
  course TEXT,                       -- 课程名（可空）
  cond INTEGER,                      -- 新旧程度 1全新 2几乎全新 3有笔记划线 4使用痕迹多（可空）
  price_cents INTEGER NOT NULL,      -- 价格（分）；批量发书为 0（哨兵），价格看 price_note
  price_note TEXT,                   -- 价格文字描述（批量发书共用，如"左边10r/本，右边20r/本"）
  note TEXT,                         -- 补充说明（可空）
  photo INTEGER NOT NULL DEFAULT 0,  -- 是否有封面图
  status TEXT NOT NULL DEFAULT 'on' CHECK(status IN ('on','off','sold')), -- on 在售 off 已下架 sold 已售出
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS book_chats(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  seller_id INTEGER NOT NULL,
  buyer_id INTEGER NOT NULL,
  unread_seller INTEGER NOT NULL DEFAULT 0,
  unread_buyer INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER,
  closed INTEGER NOT NULL DEFAULT 0,  -- 标记售出即删时置 1，关闭会话
  UNIQUE(book_id, buyer_id)
);
CREATE TABLE IF NOT EXISTS book_messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  text TEXT,
  lat REAL,
  lon REAL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',   -- open 待处理 / resolved 已处理
  reply_note TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS active_days(
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,              -- 北京时间 YYYY-MM-DD
  PRIMARY KEY(user_id, day)
);
CREATE TABLE IF NOT EXISTS book_reports(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  reporter_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT,
  created_at INTEGER NOT NULL
);
-- 心愿单（求购）：与 books 平行的需求侧，无价格，可自提标记
CREATE TABLE IF NOT EXISTS wishes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id INTEGER NOT NULL,
  title TEXT NOT NULL,               -- 书名（批量发心愿为 AI 识别的书名数组，一条一个）
  course TEXT,                       -- 对应课程（选填）
  note TEXT,                         -- 补充说明（选填：版本/作者/品相要求等）
  location TEXT,                     -- 交易地点（必填，所有心愿共用一条描述）
  pickup_ok INTEGER NOT NULL DEFAULT 0, -- 可自提：卖家不用送，买家上门取
  photo INTEGER NOT NULL DEFAULT 0,  -- 选填参考图（如学校书单截图）
  status TEXT NOT NULL DEFAULT 'on' CHECK(status IN ('on','off')), -- on 显示中 off 已下架
  created_at TEXT NOT NULL
);
-- 心愿私聊：卖家 <-> 心愿发布者（买家）。与书市聊天分表、收件箱合并展示
CREATE TABLE IF NOT EXISTS wish_chats(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wish_id INTEGER NOT NULL,
  buyer_id INTEGER NOT NULL,         -- 心愿发布者
  seller_id INTEGER NOT NULL,        -- 联系的卖家
  unread_buyer INTEGER NOT NULL DEFAULT 0,
  unread_seller INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER,
  closed INTEGER NOT NULL DEFAULT 0, -- 心愿标记已买到删除时置 1
  UNIQUE(wish_id, seller_id)
);
CREATE TABLE IF NOT EXISTS wish_messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  text TEXT,
  lat REAL,
  lon REAL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_books_status ON books(status, id DESC);
CREATE INDEX IF NOT EXISTS idx_books_seller ON books(seller_id);
CREATE INDEX IF NOT EXISTS idx_bchats_user ON book_chats(seller_id, last_at DESC);
CREATE INDEX IF NOT EXISTS idx_bmsgs_chat ON book_messages(chat_id, id);
CREATE INDEX IF NOT EXISTS idx_wishes_status ON wishes(status, id DESC);
CREATE INDEX IF NOT EXISTS idx_wchats_seller ON wish_chats(seller_id, last_at DESC);
CREATE INDEX IF NOT EXISTS idx_wchats_buyer ON wish_chats(buyer_id, last_at DESC);
CREATE INDEX IF NOT EXISTS idx_wmsgs_chat ON wish_messages(chat_id, id);
`);

// 老库迁移：books 增加交易地点列 + 批量价格描述列（老库补列，新库建表已含则跳过）
{
  const bookCols = db.prepare(`PRAGMA table_info(books)`).all().map((c) => c.name);
  if (!bookCols.includes('location')) {
    db.exec(`ALTER TABLE books ADD COLUMN location TEXT`);
    console.log('[migrate] books 表已增加 location 列');
  }
  // 批量发书：价格文字描述（如"左边10r/本，右边20r/本"）。批量书 price_cents=0（哨兵，
  // 单本最低 0.01 元不可能是 0），买家端价格位显示 price_note
  if (!bookCols.includes('price_note')) {
    db.exec(`ALTER TABLE books ADD COLUMN price_note TEXT`);
    console.log('[migrate] books 表已增加 price_note 列');
  }
}

// 老库迁移：users.grade 列（入学年份）。年级已不再收集（注册只填昵称），
// 列保留作历史数据，新用户默认 0；一次性回填已完成，此处不再改动存量数据
{
  const userCols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
  if (!userCols.includes('grade')) {
    db.exec(`ALTER TABLE users ADD COLUMN grade INTEGER NOT NULL DEFAULT 0`);
    console.log('[migrate] users 表已增加 grade 列');
  }
}

// 学校与默认可调设置
{
  let school = db.prepare(`SELECT id FROM schools WHERE name='武汉大学'`).get();
  if (!school) {
    const r = db.prepare(`INSERT INTO schools(name) VALUES('武汉大学')`).run();
    school = { id: r.lastInsertRowid };
  }
  const ins = db.prepare(`INSERT OR IGNORE INTO settings(k,v) VALUES(?,?)`);
  for (const [k, v] of Object.entries(DEFAULTS)) ins.run(k, String(v));
}

// ---------- 设置 ----------
// 数字型配置转 int；apk_url/version_note 这类字符串必须原样返回
// （此前一律 parseInt：NaN 判断挡不住"1.修复了xxx"这种数字开头的说明文本，
//   parseInt 只取前缀得到 1，更新说明存得再完整发出去也只剩一个 1）
function getSettings() {
  const out = {};
  for (const row of db.prepare(`SELECT k,v FROM settings`).all()) {
    out[row.k] = /^-?\d+$/.test(row.v) ? parseInt(row.v, 10) : row.v;
  }
  return out;
}
function setSetting(k, v) {
  db.prepare(`INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`).run(k, String(v));
}

// 北京时间日期键（与 util.js todayKey 一致；db.js 不反向 require util 防循环依赖）
const bjDay = (offsetDays = 0) => new Date(Date.now() + 8 * 3600 * 1000 - offsetDays * 86400000).toISOString().slice(0, 10);

// 活跃统计：每个登录用户每天记一行（幂等），DAU/WAU/MAU 按此去重统计
function recordActivity(uid) {
  try {
    db.prepare(`INSERT OR IGNORE INTO active_days(user_id, day) VALUES(?, ?)`).run(uid, bjDay(0));
  } catch (e) { console.log('[stats] 记录活跃失败:', e.message); }
}
function activeStats() {
  const today = bjDay(0);
  const weekAgo = bjDay(7);
  const monthAgo = bjDay(30);
  return {
    dau: db.prepare(`SELECT COUNT(DISTINCT user_id) c FROM active_days WHERE day=?`).get(today).c,
    wau: db.prepare(`SELECT COUNT(DISTINCT user_id) c FROM active_days WHERE day>=?`).get(weekAgo).c,
    mau: db.prepare(`SELECT COUNT(DISTINCT user_id) c FROM active_days WHERE day>=?`).get(monthAgo).c,
  };
}

module.exports = { db, tx, getSettings, setSetting, recordActivity, activeStats };

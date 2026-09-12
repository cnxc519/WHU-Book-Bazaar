// 书市：发布二手书 / 浏览搜索 / 详情 / 联系买家卖家 / 举报（平台不代收钱，线下当面交易）
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { db, tx, getSettings } = require('../db');
const { requireUser } = require('../auth');
const { ok, fail, nowTs, clampInt } = require('../util');
const { userPublic, fuzzyHit } = require('../business');
const { pushToUser } = require('../ws');
const { notifyFirstContact } = require('../mailer');

const router = express.Router();
router.use(requireUser);

const BOOK_STATUS = ['on', 'off', 'sold'];
const COND_CN = { 1: '全新未使用', 2: '几乎全新', 3: '有笔记划线', 4: '使用痕迹较多' };

function notify(userId, type, title, body, data) {
  const r = db.prepare(`INSERT INTO notifications(user_id,type,title,body,data_json,created_at) VALUES(?,?,?,?,?,?)`)
    .run(userId, type, title, body, JSON.stringify(data || {}), nowTs());
  pushToUser(userId, { t: 'notif', n: { id: r.lastInsertRowid, type, title, body, data } });
}

function bookCard(b) {
  const seller = db.prepare(`SELECT id,nickname,gender,avatar,school_id FROM users WHERE id=?`).get(b.seller_id);
  const school = db.prepare(`SELECT name FROM schools WHERE id=?`).get(seller ? seller.school_id : 0);
  return {
    id: b.id, title: b.title, course: b.course, cond: b.cond, cond_cn: b.cond ? COND_CN[b.cond] || '' : '',
    price_cents: b.price_cents, price_note: b.price_note || '', note: b.note, photo: b.photo, location: b.location || '',
    status: b.status, created_at: b.created_at,
    school: school ? school.name : '',
    seller: seller ? { id: seller.id, nickname: seller.nickname, gender: seller.gender, avatar: seller.avatar } : null,
  };
}

// 价格排序：批量书 price_cents=0（只有文字价格），无法参与比价，固定排在最后
function priceVal(b) { return b.price_cents > 0 ? b.price_cents : null; }

// 图片上传人校验：仅本人
function getOwnBookOrFail(req, res) {
  const b = db.prepare(`SELECT * FROM books WHERE id=?`).get(parseInt(req.params.id, 10));
  if (!b) { fail(res, '书籍不存在', 404, 'NOT_FOUND'); return null; }
  if (b.seller_id !== req.user.id) { fail(res, '只能操作自己发布的书籍', 403, 'FORBIDDEN'); return null; }
  return b;
}

// 模糊搜索逻辑已抽到 business.js（书市与心愿单共用）

// ---------- 发布 ----------
router.post('/', (req, res) => {
  const me = req.user;
  const title = String(req.body.title || '').trim();
  const course = String(req.body.course || '').trim();
  const note = String(req.body.note || '').trim();
  const location = String(req.body.location || '').trim();
  if (title.length < 1 || title.length > 40) return fail(res, '书名需为 1-40 字');
  if (location.length < 2 || location.length > 30) return fail(res, '请填写交易地点（2-30 字，方便买家当面取书）');
  if (course.length > 30) return fail(res, '课程名最多 30 字');
  if (note.length > 300) return fail(res, '补充说明最多 300 字');
  const price = Math.round(parseFloat(req.body.price_cents));
  if (!Number.isFinite(price) || price < 1 || price > 99999) return fail(res, '价格需在 0.01-999.99 元之间');
  let cond = parseInt(req.body.cond, 10);
  if (cond && !(cond >= 1 && cond <= 4)) cond = null;
  if (!cond) cond = null;

  const r = db.prepare(`INSERT INTO books(seller_id,title,course,cond,price_cents,note,location,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(me.id, title, course || null, cond, price, note || null, location || null, new Date().toISOString());
  ok(res, { id: r.lastInsertRowid });
});

// ---------- 批量发书 ----------
// 卖家把所有书放一起拍一张照很常见，单本逐个发太繁琐。流程：
// 1) POST /batch/analyze  上传合照 -> 服务端调 GLM 视觉识别书名（key 只在服务端）-> 返回书名数组
// 2) POST /batch          书名数组 + 共用地点 + 价格文字描述 + 合照 -> 一次建 N 本书，
//    合照复制为每本书的封面（/files/books/{id}.jpg），完全复用单本书的浏览/详情/聊天逻辑
// 批量书 price_cents=0（哨兵：单本最低 0.01 元），价格展示用 price_note 文字

const cfg = require('../config').cfg;
const ANALYZE_MAX = 20;

// 识别频率限制（内存级即可，防手抖连点烧 token）：每用户 6 次/分钟、30 次/天
const analyzeHits = {};
function analyzeRateOk(uid) {
  const now = Date.now();
  const h = analyzeHits[uid] || (analyzeHits[uid] = { minute: [], day: [] });
  h.minute = h.minute.filter((t) => now - t < 60e3);
  h.day = h.day.filter((t) => now - t < 86400e3);
  if (h.minute.length >= 6 || h.day.length >= 30) return false;
  h.minute.push(now); h.day.push(now);
  return true;
}

// 调 GLM 视觉识别书名；失败/未配置返回 { error } 
async function aiDetectTitles(imageBuffer, mime) {
  const ai = cfg.ai;
  if (!ai || !ai.api_key || String(ai.api_key).includes('你的')) return { error: '图片识别未配置，请手动填写书名' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60e3);
  try {
    const r = await fetch((ai.base_url || 'https://open.bigmodel.cn/api/paas/v4') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ai.api_key },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: ai.model || 'glm-5.3-flash',
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mime || 'image/jpeg'};base64,` + imageBuffer.toString('base64') } },
            { type: 'text', text: '这是卖家把多本旧书放在一起拍的照片。请识别图中每一本书的书名。'
              + '要求：只输出 JSON，格式 {"books":["书名1","书名2"]}；书名以图中印刷文字为准，可去掉"第X版"里无法看清的部分，'
              + `最多 ${ANALYZE_MAX} 本；图片模糊、拍的不是书或看不清任何书名时返回 {"books":[]}。不要输出 JSON 以外的任何内容。` },
          ],
        }],
      }),
    });
    if (!r.ok) return { error: 'AI 服务异常（HTTP ' + r.status + '），请稍后重试或手动填写' };
    const j = await r.json();
    let text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '';
    text = String(text).replace(/```json|```/g, '');
    const m = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (m < 0 || e <= m) return { error: 'AI 没认出书名，请手动填写' };
    const arr = JSON.parse(text.slice(m, e + 1)).books;
    if (!Array.isArray(arr)) return { error: 'AI 没认出书名，请手动填写' };
    const titles = [...new Set(arr.map((t) => String(t || '').replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, ANALYZE_MAX);
    return { titles };
  } catch (err) {
    return { error: err.name === 'AbortError' ? 'AI 识别超时，请重试或手动填写' : 'AI 识别失败，请重试或手动填写' };
  } finally {
    clearTimeout(timer);
  }
}

// 合照解析（内存存储：转 base64 直接发给 AI，不落盘）
const analyzeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okType = file.mimetype === 'image/jpeg' || file.mimetype === 'image/png';
    cb(okType ? null : new Error('仅支持 JPG/PNG 图片'), okType);
  },
});

router.post('/batch/analyze', analyzeUpload.single('file'), async (req, res) => {
  if (!analyzeRateOk(req.user.id)) return fail(res, '识别太频繁啦，稍等片刻再试');
  if (!req.file) return fail(res, '请选择合照（把要卖的书放一起拍一张）');
  const out = await aiDetectTitles(req.file.buffer, req.file.mimetype);
  if (out.error) return fail(res, out.error);
  if (!out.titles.length) return fail(res, 'AI 没认出书名——请把书名拍清楚再试，或手动填写');
  ok(res, { titles: out.titles });
});

// 批量发布：multipart 字段 titles(JSON数组串) / location / price_note + 合照 file
const batchUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okType = file.mimetype === 'image/jpeg' || file.mimetype === 'image/png';
    cb(okType ? null : new Error('仅支持 JPG/PNG 图片'), okType);
  },
});

router.post('/batch', batchUpload.single('file'), (req, res) => {
  let titles;
  try { titles = JSON.parse(String(req.body.titles || '[]')); } catch (e) { titles = null; }
  if (!Array.isArray(titles)) return fail(res, '书名列表格式不正确');
  titles = [...new Set(titles.map((t) => String(t || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
  if (!titles.length || titles.length > ANALYZE_MAX) return fail(res, `请填写 1-${ANALYZE_MAX} 个书名`);
  if (titles.some((t) => t.length > 40)) return fail(res, '书名最长 40 字');
  const location = String(req.body.location || '').trim();
  if (location.length < 2 || location.length > 30) return fail(res, '请填写交易地点（2-30 字，方便买家当面取书）');
  const priceNote = String(req.body.price_note || '').trim();
  if (priceNote.length < 1 || priceNote > 60) return fail(res, '请填写价格描述（1-60 字，如：左边10r/本，右边20r/本）');
  if (!req.file) return fail(res, '请附带合照作为封面');

  const dir = path.join(__dirname, '..', '..', 'uploads', 'books');
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const ids = [];
  try {
    const insert = db.prepare(`INSERT INTO books(seller_id,title,cond,price_cents,price_note,location,photo,created_at) VALUES(?,?,?,?,?,?,1,?)`);
    tx(() => {
      for (const t of titles) {
        const r = insert.run(req.user.id, t, null, 0, priceNote, location, now);
        ids.push(Number(r.lastInsertRowid));
      }
    });
    // 同一张合照作为每本书的封面（每本约几十~两百 KB，成本可忽略；
    // 复用 /files/books/{id}.jpg 后买家端浏览/详情/聊天零改动）
    for (const id of ids) fs.writeFileSync(path.join(dir, id + '.jpg'), req.file.buffer);
  } catch (e) {
    console.error('[books/batch] 发布失败:', e.message);
    // 失败回滚已插入的行，避免留下没封面的半截批量书
    for (const id of ids) {
      db.prepare(`DELETE FROM books WHERE id=? AND seller_id=?`).run(id, req.user.id);
      try { fs.unlinkSync(path.join(dir, id + '.jpg')); } catch (e2) {}
    }
    return fail(res, '发布失败，请重试');
  }
  ok(res, { count: ids.length, ids });
});

// ---------- 浏览列表（在售；仅本校，支持模糊搜索） ----------
router.get('/', (req, res) => {
  const me = req.user;
  const page = clampInt(req.query.page, 1, 1000, 1);
  const size = 20;
  const fQ = String(req.query.q || '').trim().toLowerCase().replace(/\s+/g, '');
  const sort = ['latest', 'price_asc', 'price_desc'].includes(req.query.sort) ? req.query.sort : 'latest';

  // 数据按学校隔离：只能看到本校同学的在售书；包含自己发布的（is_mine 标记，
  // 网页端打"我的"角标，详情页走卖家视图：管理入口，无联系/举报）
  const rows = db.prepare(`SELECT b.*, (b.seller_id = ?) AS is_mine FROM books b JOIN users u ON u.id=b.seller_id
      WHERE b.status='on' AND u.school_id=?
        AND NOT EXISTS(SELECT 1 FROM users u2 WHERE u2.id=b.seller_id AND u2.banned=1)
      ORDER BY b.id DESC`)
    .all(me.id, me.school_id);

  let list = rows;
  if (fQ) list = list.filter((b) => fuzzyHit(fQ, b.title) || fuzzyHit(fQ, b.course) || fuzzyHit(fQ, b.note) || fuzzyHit(fQ, b.price_note));
  if (sort === 'price_asc') list.sort((a, b) => (priceVal(a) ?? Infinity) - (priceVal(b) ?? Infinity) || b.id - a.id);
  else if (sort === 'price_desc') list.sort((a, b) => (priceVal(b) ?? -Infinity) - (priceVal(a) ?? -Infinity) || b.id - a.id);

  const total = list.length;
  const slice = list.slice((page - 1) * size, page * size);
  ok(res, { list: slice.map((b) => ({ ...bookCard(b), is_mine: !!b.is_mine })), total, has_more: page * size < total });
});

// ---------- 我的书（全部状态，管理用） ----------
router.get('/mine', (req, res) => {
  const rows = db.prepare(`SELECT * FROM books WHERE seller_id=? AND status!='sold' ORDER BY id DESC LIMIT 100`).all(req.user.id);
  const list = rows.map((b) => {
    const card = bookCard(b);
    const unread = db.prepare(`SELECT COALESCE(SUM(unread_seller),0) n FROM book_chats WHERE book_id=? AND seller_id=?`).get(b.id, req.user.id).n;
    card.unread_chats = unread;
    return card;
  });
  ok(res, { list });
});

// ---------- 详情 ----------
router.get('/:id', (req, res) => {
  const me = req.user;
  const b = db.prepare(`SELECT * FROM books WHERE id=?`).get(parseInt(req.params.id, 10));
  if (!b) return fail(res, '书籍不存在', 404, 'NOT_FOUND');
  const isSeller = b.seller_id === me.id;
  // 已下架的书买家仍可查看详情并联系（沟通好未见面就下架的场景）；已售出=已删除，查不到自然 404
  if (!isSeller && !['on', 'off'].includes(b.status)) return fail(res, '该书籍已售出', 404, 'NOT_FOUND');
  const seller = db.prepare(`SELECT * FROM users WHERE id=?`).get(b.seller_id);
  // 数据按学校隔离：只能查看本校同学的书（已有的跨校会话买家不受影响，可继续交易）
  const myThread = isSeller ? null : db.prepare(`SELECT id, unread_buyer FROM book_chats WHERE book_id=? AND buyer_id=?`).get(b.id, me.id);
  if (!isSeller && seller.school_id !== me.school_id && !myThread) {
    return fail(res, '只能查看本校同学发布的书籍', 403, 'FORBIDDEN');
  }
  const school = db.prepare(`SELECT name FROM schools WHERE id=?`).get(seller.school_id);
  // 卖家在售数（含当前这本）：详情页卖家卡展示
  const sellerBooksOn = db.prepare(`SELECT COUNT(*) c FROM books WHERE seller_id=? AND status='on'`).get(seller.id).c;
  ok(res, {
    ...bookCard(b),
    seller: {
      id: seller.id, nickname: seller.nickname, gender: seller.gender, avatar: seller.avatar,
      school: school ? school.name : '', created_at: seller.created_at,
      books_on: sellerBooksOn,
    },
    is_seller: isSeller,
    my_thread: myThread ? { chat_id: myThread.id, unread: myThread.unread_buyer } : null,
  });
});

// ---------- 封面图上传（可选一张 ≤200KB；上传/更换） ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'uploads', 'books');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${req.params.id}.jpg`),
});
const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okType = file.mimetype === 'image/jpeg' || file.mimetype === 'image/png';
    cb(okType ? null : new Error('仅支持 JPG/PNG 图片'), okType);
  },
});

router.post('/:id/photo', (req, res) => {
  const b = getOwnBookOrFail(req, res);
  if (!b) return;
  upload.single('file')(req, res, (err) => {
    if (err) return fail(res, err.message === '仅支持 JPG/PNG 图片' ? err.message : '图片上传失败，大小请勿超过限制');
    if (!req.file) return fail(res, '请选择图片');
    const s = getSettings();
    const sizeKb = fs.statSync(req.file.path).size / 1024;
    if (sizeKb > s.avatar_max_kb) {
      fs.unlinkSync(req.file.path);
      return fail(res, `图片超过 ${s.avatar_max_kb}KB 限制，请重新选择（应用会自动压缩）`);
    }
    db.prepare(`UPDATE books SET photo=1 WHERE id=?`).run(b.id);
    ok(res, { url: `/files/books/${b.id}.jpg?t=${Date.now()}` });
  });
});

// ---------- 联系卖家（买家首次点“联系”时创建会话） ----------
router.post('/:id/contact', (req, res) => {
  const me = req.user;
  const b = db.prepare(`SELECT * FROM books WHERE id=?`).get(parseInt(req.params.id, 10));
  if (!b) return fail(res, '书籍不存在', 404, 'NOT_FOUND');
  if (b.seller_id === me.id) return fail(res, '不能联系自己');
  if (b.status === 'sold') return fail(res, '该书籍已标记售出'); // off（下架）也允许联系：沟通好未见面就下架的场景
  const seller = db.prepare(`SELECT banned,school_id FROM users WHERE id=?`).get(b.seller_id);
  if (!seller || seller.banned) return fail(res, '卖家账号异常，暂无法联系');
  // 数据按学校隔离：只能联系本校卖家（线下当面交易，跨校见不了面）
  if (seller.school_id !== me.school_id) return fail(res, '只能联系本校同学发布的书籍');

  let chat = db.prepare(`SELECT * FROM book_chats WHERE book_id=? AND buyer_id=?`).get(b.id, me.id);
  if (!chat) {
    const r = db.prepare(`INSERT INTO book_chats(book_id,seller_id,buyer_id,last_at) VALUES(?,?,?,?)`)
      .run(b.id, b.seller_id, me.id, nowTs());
    chat = db.prepare(`SELECT * FROM book_chats WHERE id=?`).get(r.lastInsertRowid);
    db.prepare(`INSERT INTO book_messages(chat_id,sender_id,type,text,created_at) VALUES(?,0,'system',?,?)`)
      .run(chat.id, `买家 ${me.nickname} 想买《${b.title}》，请与 TA 沟通价格与交易地点（平台不代收钱，见面当面交易）`, nowTs());
    notify(b.seller_id, 'book_contact', `有人想买《${b.title}》`, `${me.nickname} 想买你发布的《${b.title}》（${(b.price_cents / 100).toFixed(2)} 元），去「书市-消息」回复 TA`,
      { book_id: b.id, chat_id: chat.id });
    // 重要消息邮件提醒（仅首次联系；发送失败不影响主流程）
    const sellerEmail = db.prepare(`SELECT email FROM users WHERE id=?`).get(b.seller_id);
    if (sellerEmail) notifyFirstContact(sellerEmail.email, b.title, me.nickname);
    pushToUser(b.seller_id, { t: 'bchat', chat_id: chat.id });
    pushToUser(me.id, { t: 'bchat', chat_id: chat.id });
  }
  ok(res, { chat_id: chat.id });
});

// ---------- 举报某本书 ----------
router.post('/:id/report', (req, res) => {
  const me = req.user;
  const b = db.prepare(`SELECT * FROM books WHERE id=?`).get(parseInt(req.params.id, 10));
  if (!b) return fail(res, '书籍不存在', 404, 'NOT_FOUND');
  if (b.seller_id === me.id) return fail(res, '不能举报自己的书籍');
  const dup = db.prepare(`SELECT id FROM book_reports WHERE book_id=? AND reporter_id=? AND status='open'`).get(b.id, me.id);
  if (dup) return fail(res, '你已举报过该书籍，等待处理');
  const reason = String(req.body.reason || '').trim();
  if (reason.length < 5 || reason.length > 200) return fail(res, '请填写举报原因（5-200 字）');
  db.prepare(`INSERT INTO book_reports(book_id,reporter_id,reason,created_at) VALUES(?,?,?,?)`)
    .run(b.id, me.id, reason, nowTs());
  ok(res, { ok: true, msg: '举报已提交，平台将审核处理' });
});

// ---------- 状态管理：off 暂时下架 / on 重新上架 / sold 标记已售出（删除） ----------
router.post('/:id/status', (req, res) => {
  const b = getOwnBookOrFail(req, res);
  if (!b) return;
  const st = req.body.status;
  if (!BOOK_STATUS.includes(st)) return fail(res, '状态不正确');
  if (st === 'sold') {
    // 标记已售出 = 从平台删除：书信息与封面文件一并清除，相关会话关闭（买家无法再发起联系）；
    // 聊天消息保留（争议凭证），会话列表显示"已删除的书"
    db.prepare(`DELETE FROM books WHERE id=?`).run(b.id);
    db.prepare(`UPDATE book_chats SET closed=1 WHERE book_id=?`).run(b.id);
    try { fs.unlinkSync(path.join(__dirname, '..', '..', 'uploads', 'books', b.id + '.jpg')); } catch (e) {}
    return ok(res, { id: b.id, status: 'sold' });
  }
  db.prepare(`UPDATE books SET status=? WHERE id=?`).run(st, b.id);
  // 重新上架时把上架时间重置为现在：1 年自动下架（见 sweeps.js）从重新上架重新计
  if (st === 'on') db.prepare(`UPDATE books SET created_at=? WHERE id=?`).run(new Date().toISOString(), b.id);
  ok(res, { id: b.id, status: st });
});

module.exports = router;

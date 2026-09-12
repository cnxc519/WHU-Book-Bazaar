// 心愿单（求购）：发布想买的书 / 浏览搜索 / 详情 / 联系心愿发布者（平台不代收钱，线下当面交易）
// 与 books.js 平行的需求侧：无价格，多一个"可自提"标记；图片选填（如学校书单截图）
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { db, tx, getSettings } = require('../db');
const { requireUser } = require('../auth');
const { ok, fail, nowTs, clampInt } = require('../util');
const { fuzzyHit } = require('../business');
const { pushToUser } = require('../ws');
const { notifyWishContact } = require('../mailer');

const router = express.Router();
router.use(requireUser);

const WISH_STATUS = ['on', 'off', 'done'];

function notify(userId, type, title, body, data) {
  const r = db.prepare(`INSERT INTO notifications(user_id,type,title,body,data_json,created_at) VALUES(?,?,?,?,?,?)`)
    .run(userId, type, title, body, JSON.stringify(data || {}), nowTs());
  pushToUser(userId, { t: 'notif', n: { id: r.lastInsertRowid, type, title, body, data } });
}

function wishCard(w) {
  const buyer = db.prepare(`SELECT id,nickname,gender,avatar,school_id FROM users WHERE id=?`).get(w.buyer_id);
  const school = db.prepare(`SELECT name FROM schools WHERE id=?`).get(buyer ? buyer.school_id : 0);
  return {
    id: w.id, title: w.title, course: w.course, note: w.note, location: w.location || '',
    pickup_ok: !!w.pickup_ok, photo: w.photo, status: w.status, created_at: w.created_at,
    school: school ? school.name : '',
    buyer: buyer ? { id: buyer.id, nickname: buyer.nickname, gender: buyer.gender, avatar: buyer.avatar } : null,
  };
}

// 图片上传人校验：仅本人
function getOwnWishOrFail(req, res) {
  const w = db.prepare(`SELECT * FROM wishes WHERE id=?`).get(parseInt(req.params.id, 10));
  if (!w) { fail(res, '心愿不存在', 404, 'NOT_FOUND'); return null; }
  if (w.buyer_id !== req.user.id) { fail(res, '只能操作自己发布的心愿', 403, 'FORBIDDEN'); return null; }
  return w;
}

// ---------- 发布（单条） ----------
router.post('/', (req, res) => {
  const me = req.user;
  const title = String(req.body.title || '').trim();
  const course = String(req.body.course || '').trim();
  const note = String(req.body.note || '').trim();
  const location = String(req.body.location || '').trim();
  const pickupOk = req.body.pickup_ok ? 1 : 0;
  if (title.length < 1 || title.length > 40) return fail(res, '书名需为 1-40 字');
  if (location.length > 30) return fail(res, '地点最多 30 字');
  // 可自提时地点可不填（卖家上门取）；希望送到附近才需要给个参考地点
  if (!pickupOk && location.length < 2) return fail(res, '请填写交易地点（2-30 字；选"可自提"时可以不填）');
  if (course.length > 30) return fail(res, '课程名最多 30 字');
  if (note.length > 300) return fail(res, '补充说明最多 300 字');

  const r = db.prepare(`INSERT INTO wishes(buyer_id,title,course,note,location,pickup_ok,created_at) VALUES(?,?,?,?,?,?,?)`)
    .run(me.id, title, course || null, note || null, location || null, pickupOk, new Date().toISOString());
  ok(res, { id: r.lastInsertRowid });
});

// ---------- 批量发心愿 ----------
// 与卖书批量同思路：上传一张书单照片（教材征订单/Excel 截图），AI 识别【需要购买】的书名
// （已划掉的书名要排除），核对增删改后一次发布；照片选填，有则作为每条心愿的参考图
const cfg = require('../config').cfg;
const ANALYZE_MAX = 20;

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

// 调 GLM 视觉识别书单；失败/未配置返回 { error }
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
            { type: 'text', text: '这是一张学生拿来对照购买二手教材的书单照片（可能是教材征订单或 Excel 截图）。请识别图中【需要购买】的教材书名。'
              + '重要：书名被划掉/删除线/横线划除的条目表示已购或不需要，必须排除，不要输出。'
              + '要求：只输出 JSON，格式 {"books":["书名1","书名2"]}；书名以图中印刷文字为准，可去掉"第X版"等版本后缀中无法看清的部分；'
              + `最多 ${ANALYZE_MAX} 本；图片模糊、拍的不是书单或识别不出任何书名时返回 {"books":[]}。不要输出 JSON 以外的任何内容。` },
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
  if (!req.file) return fail(res, '请选择书单照片（教材征订单/书单截图都可以）');
  const out = await aiDetectTitles(req.file.buffer, req.file.mimetype);
  if (out.error) return fail(res, out.error);
  if (!out.titles.length) return fail(res, 'AI 没认出书名——请把书名拍清楚再试，或手动填写');
  ok(res, { titles: out.titles });
});

// 批量发布：multipart 字段 titles(JSON数组串) / location / pickup_ok + 选填参考图 file
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
  if (location.length > 30) return fail(res, '地点最多 30 字');
  const pickupOk = req.body.pickup_ok === '1' || req.body.pickup_ok === 'true' ? 1 : 0;
  // 可自提时地点可不填（同单条心愿）
  if (!pickupOk && location.length < 2) return fail(res, '请填写交易地点（2-30 字；选"可自提"时可以不填）');

  const now = new Date().toISOString();
  const ids = [];
  try {
    const insert = db.prepare(`INSERT INTO wishes(buyer_id,title,course,note,location,pickup_ok,created_at) VALUES(?,?,?,?,?,?,?)`);
    tx(() => {
      for (const t of titles) {
        const r = insert.run(req.user.id, t, null, null, location, pickupOk, now);
        ids.push(Number(r.lastInsertRowid));
      }
    });
    // 参考图选填：上传了就作为每条心愿的图（书单截图）
    if (req.file) {
      const dir = path.join(__dirname, '..', '..', 'uploads', 'wishes');
      fs.mkdirSync(dir, { recursive: true });
      for (const id of ids) fs.writeFileSync(path.join(dir, id + '.jpg'), req.file.buffer);
      db.prepare(`UPDATE wishes SET photo=1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    }
  } catch (e) {
    console.error('[wishes/batch] 发布失败:', e.message);
    for (const id of ids) {
      db.prepare(`DELETE FROM wishes WHERE id=? AND buyer_id=?`).run(id, req.user.id);
      try { fs.unlinkSync(path.join(__dirname, '..', '..', 'uploads', 'wishes', id + '.jpg')); } catch (e2) {}
    }
    return fail(res, '发布失败，请重试');
  }
  ok(res, { count: ids.length, ids });
});

// ---------- 心愿单浏览（在售心愿；仅本校，支持模糊搜索、可自提优先） ----------
router.get('/', (req, res) => {
  const me = req.user;
  const page = clampInt(req.query.page, 1, 1000, 1);
  const size = 20;
  const fQ = String(req.query.q || '').trim().toLowerCase().replace(/\s+/g, '');
  const sort = ['latest', 'pickup'].includes(req.query.sort) ? req.query.sort : 'latest';

  // 数据按学校隔离：只能看到本校同学发的心愿（含自己的，带 is_mine 标记）
  const rows = db.prepare(`SELECT w.*, (w.buyer_id = ?) AS is_mine FROM wishes w JOIN users u ON u.id=w.buyer_id
      WHERE w.status='on' AND u.school_id=?
        AND NOT EXISTS(SELECT 1 FROM users u2 WHERE u2.id=w.buyer_id AND u2.banned=1)
      ORDER BY ${sort === 'pickup' ? 'w.pickup_ok DESC, w.id DESC' : 'w.id DESC'}`)
    .all(me.id, me.school_id);

  let list = rows;
  if (fQ) list = list.filter((w) => fuzzyHit(fQ, w.title) || fuzzyHit(fQ, w.course) || fuzzyHit(fQ, w.note));
  const total = list.length;
  const slice = list.slice((page - 1) * size, page * size);
  ok(res, { list: slice.map((w) => ({ ...wishCard(w), is_mine: !!w.is_mine })), total, has_more: page * size < total });
});

// ---------- 我的心愿（全部状态，管理用） ----------
router.get('/mine', (req, res) => {
  const rows = db.prepare(`SELECT * FROM wishes WHERE buyer_id=? ORDER BY id DESC LIMIT 100`).all(req.user.id);
  const list = rows.map((w) => {
    const card = wishCard(w);
    const unread = db.prepare(`SELECT COALESCE(SUM(unread_buyer),0) n FROM wish_chats WHERE wish_id=? AND buyer_id=?`).get(w.id, req.user.id).n;
    card.unread_chats = unread;
    return card;
  });
  ok(res, { list });
});

// ---------- 详情 ----------
router.get('/:id', (req, res) => {
  const me = req.user;
  const w = db.prepare(`SELECT * FROM wishes WHERE id=?`).get(parseInt(req.params.id, 10));
  if (!w) return fail(res, '心愿不存在', 404, 'NOT_FOUND');
  const isMine = w.buyer_id === me.id;
  // 已下架的心愿非发布者不可见（心愿没有"已售出保留联系"的场景）
  if (!isMine && w.status !== 'on') return fail(res, '该心愿已下架', 404, 'NOT_FOUND');
  const buyer = db.prepare(`SELECT * FROM users WHERE id=?`).get(w.buyer_id);
  // 数据按学校隔离：只能查看本校同学的心愿（已有跨校会话不受影响）
  const myThread = isMine ? null : db.prepare(`SELECT id, unread_seller FROM wish_chats WHERE wish_id=? AND seller_id=?`).get(w.id, me.id);
  if (!isMine && buyer.school_id !== me.school_id && !myThread) {
    return fail(res, '只能查看本校同学发布的心愿', 403, 'FORBIDDEN');
  }
  const school = db.prepare(`SELECT name FROM schools WHERE id=?`).get(buyer.school_id);
  const buyerBooksOn = db.prepare(`SELECT COUNT(*) c FROM books WHERE seller_id=? AND status='on'`).get(buyer.id).c;
  ok(res, {
    ...wishCard(w),
    is_mine: isMine,
    buyer: {
      id: buyer.id, nickname: buyer.nickname, gender: buyer.gender, avatar: buyer.avatar,
      school: school ? school.name : '', created_at: buyer.created_at,
      books_on: buyerBooksOn,
    },
    my_thread: myThread ? { chat_id: myThread.id, unread: myThread.unread_seller } : null,
  });
});

// ---------- 参考图上传（选填一张 ≤200KB；上传/更换） ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'uploads', 'wishes');
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
  const w = getOwnWishOrFail(req, res);
  if (!w) return;
  upload.single('file')(req, res, (err) => {
    if (err) return fail(res, err.message === '仅支持 JPG/PNG 图片' ? err.message : '图片上传失败，大小请勿超过限制');
    if (!req.file) return fail(res, '请选择图片');
    const s = getSettings();
    const sizeKb = fs.statSync(req.file.path).size / 1024;
    if (sizeKb > s.avatar_max_kb) {
      fs.unlinkSync(req.file.path);
      return fail(res, `图片超过 ${s.avatar_max_kb}KB 限制，请重新选择（应用会自动压缩）`);
    }
    db.prepare(`UPDATE wishes SET photo=1 WHERE id=?`).run(w.id);
    ok(res, { url: `/files/wishes/${w.id}.jpg?t=${Date.now()}` });
  });
});

// ---------- 联系心愿发布者（卖家首次点"联系"时创建会话） ----------
router.post('/:id/contact', (req, res) => {
  const me = req.user;
  const w = db.prepare(`SELECT * FROM wishes WHERE id=?`).get(parseInt(req.params.id, 10));
  if (!w) return fail(res, '心愿不存在', 404, 'NOT_FOUND');
  if (w.buyer_id === me.id) return fail(res, '这是你自己发布的心愿');
  if (w.status !== 'on') return fail(res, '该心愿已下架');
  const buyer = db.prepare(`SELECT banned,school_id,email FROM users WHERE id=?`).get(w.buyer_id);
  if (!buyer || buyer.banned) return fail(res, '对方账号异常，暂无法联系');
  // 数据按学校隔离：只能联系本校同学的心愿（线下当面交易，跨校见不了面）
  if (buyer.school_id !== me.school_id) return fail(res, '只能联系本校同学发布的心愿');

  let chat = db.prepare(`SELECT * FROM wish_chats WHERE wish_id=? AND seller_id=?`).get(w.id, me.id);
  if (!chat) {
    const r = db.prepare(`INSERT INTO wish_chats(wish_id,buyer_id,seller_id,last_at) VALUES(?,?,?,?)`)
      .run(w.id, w.buyer_id, me.id, nowTs());
    chat = db.prepare(`SELECT * FROM wish_chats WHERE id=?`).get(r.lastInsertRowid);
    db.prepare(`INSERT INTO wish_messages(chat_id,sender_id,type,text,created_at) VALUES(?,0,'system',?,?)`)
      .run(chat.id, `卖家 ${me.nickname} 想出售《${w.title}》，请与 TA 聊清楚版本与品相（平台不代收钱，见面当面交易）`, nowTs());
    notify(w.buyer_id, 'wish_contact', `有人想卖你心愿里的《${w.title}》`, `${me.nickname} 想出售你心愿里的《${w.title}》，去「消息」回复 TA`,
      { wish_id: w.id, chat_id: chat.id, kind: 'wish' });
    // 重要消息邮件提醒（仅首次联系；发送失败不影响主流程）
    notifyWishContact(buyer.email, w.title, me.nickname);
    pushToUser(w.buyer_id, { t: 'wchat', chat_id: chat.id });
    pushToUser(me.id, { t: 'wchat', chat_id: chat.id });
  }
  ok(res, { chat_id: chat.id });
});

// ---------- 状态管理：off 暂时下架 / on 重新上架 / done 已买到（删除） ----------
router.post('/:id/status', (req, res) => {
  const w = getOwnWishOrFail(req, res);
  if (!w) return;
  const st = req.body.status;
  if (!WISH_STATUS.includes(st)) return fail(res, '状态不正确');
  if (st === 'done') {
    // 已买到 = 从平台删除：心愿与参考图一并清除，相关会话关闭（卖家无法再发起联系）；
    // 聊天消息保留（争议凭证），会话列表显示"已删除的心愿"
    db.prepare(`DELETE FROM wishes WHERE id=?`).run(w.id);
    db.prepare(`UPDATE wish_chats SET closed=1 WHERE wish_id=?`).run(w.id);
    try { fs.unlinkSync(path.join(__dirname, '..', '..', 'uploads', 'wishes', w.id + '.jpg')); } catch (e) {}
    return ok(res, { id: w.id, status: 'done' });
  }
  db.prepare(`UPDATE wishes SET status=? WHERE id=?`).run(st, w.id);
  // 重新上架时把发布时间重置为现在：心愿 2 个月时效（见 sweeps.js）从重新上架重新计
  if (st === 'on') db.prepare(`UPDATE wishes SET created_at=? WHERE id=?`).run(new Date().toISOString(), w.id);
  ok(res, { id: w.id, status: st });
});

module.exports = router;

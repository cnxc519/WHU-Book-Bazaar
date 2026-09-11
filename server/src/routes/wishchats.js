// 心愿私聊：卖家 <-> 心愿发布者（买家）。支持文字与位置；会话长期保留
// 与书市聊天（bookchats）分表、收件箱合并展示；事件推送事件名 wchat
const express = require('express');
const { db } = require('../db');
const { requireUser } = require('../auth');
const { ok, fail, nowTs, clampInt } = require('../util');
const { pushToUser } = require('../ws');

const router = express.Router();
router.use(requireUser);

// 校验我是会话参与者（心愿发布者或联系它的卖家），返回 chat + 对方
function getChatOrFail(req, res) {
  const chat = db.prepare(`SELECT * FROM wish_chats WHERE id=?`).get(parseInt(req.params.id, 10));
  if (!chat) { fail(res, '会话不存在', 404, 'NOT_FOUND'); return null; }
  const me = req.user.id;
  if (chat.seller_id !== me && chat.buyer_id !== me) { fail(res, '无权访问该会话', 403, 'FORBIDDEN'); return null; }
  const other = db.prepare(`SELECT id,nickname,avatar,gender FROM users WHERE id=?`)
    .get(chat.buyer_id === me ? chat.seller_id : chat.buyer_id);
  return { chat, other, me };
}

function notify(userId, type, title, body, data) {
  const r = db.prepare(`INSERT INTO notifications(user_id,type,title,body,data_json,created_at) VALUES(?,?,?,?,?,?)`)
    .run(userId, type, title, body, JSON.stringify(data || {}), nowTs());
  pushToUser(userId, { t: 'notif', n: { id: r.lastInsertRowid, type, title, body, data } });
}

// 会话列表（收件箱与书市聊天合并展示，网页端按 last_message 时间排序）
router.get('/', (req, res) => {
  const me = req.user.id;
  const rows = db.prepare(`SELECT * FROM wish_chats WHERE seller_id=? OR buyer_id=? ORDER BY last_at DESC LIMIT 100`).all(me, me);
  const list = rows.map((c) => {
    const isBuyer = c.buyer_id === me;
    const other = db.prepare(`SELECT id,nickname,avatar,gender FROM users WHERE id=?`).get(isBuyer ? c.seller_id : c.buyer_id);
    const wish = db.prepare(`SELECT id,title,photo,status,buyer_id FROM wishes WHERE id=?`).get(c.wish_id);
    const last = db.prepare(`SELECT sender_id,type,text,created_at FROM wish_messages WHERE chat_id=? ORDER BY id DESC LIMIT 1`).get(c.id);
    return {
      id: c.id, kind: 'wish', wish: wish ? { id: wish.id, title: wish.title, photo: wish.photo, status: wish.status } : null,
      role: isBuyer ? 'buyer' : 'seller',
      other,
      unread: isBuyer ? c.unread_buyer : c.unread_seller,
      last_message: last ? { sender_id: last.sender_id, type: last.type, text: last.text, created_at: last.created_at } : null,
    };
  });
  ok(res, { list });
});

// 消息记录
router.get('/:id/messages', (req, res) => {
  const g = getChatOrFail(req, res);
  if (!g) return;
  const before = clampInt(req.query.before, 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const rows = before > 0
    ? db.prepare(`SELECT * FROM wish_messages WHERE chat_id=? AND id<? ORDER BY id DESC LIMIT 100`).all(g.chat.id, before)
    : db.prepare(`SELECT * FROM wish_messages WHERE chat_id=? ORDER BY id DESC LIMIT 100`).all(g.chat.id);
  ok(res, { list: rows.reverse() });
});

// 发送消息：text / location
router.post('/:id/messages', (req, res) => {
  const g = getChatOrFail(req, res);
  if (!g) return;
  const type = req.body.type === 'location' ? 'location' : 'text';
  let text = String(req.body.text || '').trim();
  if (type === 'text') {
    if (text.length < 1) return fail(res, '消息不能为空');
    if (text.length > 1000) return fail(res, '消息最长 1000 字');
  } else {
    if (text.length > 200) return fail(res, '位置描述最长 200 字');
  }
  const lat = parseFloat(req.body.lat), lon = parseFloat(req.body.lon);
  const r = db.prepare(`INSERT INTO wish_messages(chat_id,sender_id,type,text,lat,lon,created_at) VALUES(?,?,?,?,?,?,?)`)
    .run(g.chat.id, req.user.id, type, text, Number.isFinite(lat) ? lat : null, Number.isFinite(lon) ? lon : null, nowTs());
  const msg = db.prepare(`SELECT * FROM wish_messages WHERE id=?`).get(r.lastInsertRowid);
  const isBuyer = g.chat.buyer_id === req.user.id;
  const unreadCol = isBuyer ? 'seller' : 'buyer';
  const prevUnread = db.prepare(`SELECT unread_${unreadCol} u FROM wish_chats WHERE id=?`).get(g.chat.id).u;
  db.prepare(`UPDATE wish_chats SET last_at=?, unread_${unreadCol}=unread_${unreadCol}+1 WHERE id=?`)
    .run(nowTs(), g.chat.id);
  pushToUser(g.other.id, { t: 'wchat', chat_id: g.chat.id, m: msg });
  // 未读从 0 变 1 时才发铃铛通知，避免每条都打扰；在线时由 wchat 事件即时送达
  if (prevUnread === 0) {
    const wish = db.prepare(`SELECT title FROM wishes WHERE id=?`).get(g.chat.wish_id);
    notify(g.other.id, 'wish_msg', `心愿《${wish ? wish.title : ''}》新消息`, `${req.user.nickname}：${type === 'location' ? '发来了一个位置' : text}`, { wish_id: g.chat.wish_id, chat_id: g.chat.id, kind: 'wish' });
  }
  ok(res, { m: msg });
});

// 标记已读
router.post('/:id/read', (req, res) => {
  const g = getChatOrFail(req, res);
  if (!g) return;
  if (g.chat.buyer_id === req.user.id) db.prepare(`UPDATE wish_chats SET unread_buyer=0 WHERE id=?`).run(g.chat.id);
  else db.prepare(`UPDATE wish_chats SET unread_seller=0 WHERE id=?`).run(g.chat.id);
  ok(res, { ok: true });
});

// 未读总数（Tab 角标；网页端与书市聊天相加）
router.get('/unread-count', (req, res) => {
  const me = req.user.id;
  const n = db.prepare(`SELECT (SELECT COALESCE(SUM(unread_seller),0) FROM wish_chats WHERE seller_id=?) + (SELECT COALESCE(SUM(unread_buyer),0) FROM wish_chats WHERE buyer_id=?) n`)
    .get(me, me).n;
  ok(res, { unread: n });
});

module.exports = router;

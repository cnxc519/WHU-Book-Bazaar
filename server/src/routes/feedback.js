// 意见反馈：用户提交，管理后台查看/处理
const express = require('express');
const { db } = require('../db');
const { requireUser } = require('../auth');
const { ok, fail, nowTs } = require('../util');

const router = express.Router();
const DAILY_LIMIT = 10; // 每用户每天最多 10 条

// 提交反馈（登录用户）
router.post('/', requireUser, (req, res) => {
  const content = String(req.body.content || '').trim();
  if (content.length < 5 || content.length > 500) return fail(res, '反馈内容需为 5-500 字');
  const dayStart = nowTs() - (nowTs() % 86400000) - 8 * 3600 * 1000; // 北京自然日
  const sent = db.prepare(`SELECT COUNT(*) c FROM feedback WHERE user_id=? AND created_at>=?`).get(req.user.id, dayStart).c;
  if (sent >= DAILY_LIMIT) return fail(res, '今天反馈次数太多啦，请明天再试');
  const r = db.prepare(`INSERT INTO feedback(user_id,content,created_at) VALUES(?,?,?)`)
    .run(req.user.id, content, nowTs());
  ok(res, { id: r.lastInsertRowid });
});

module.exports = router;

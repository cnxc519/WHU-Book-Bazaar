// 邀请：邀请码、已邀请人数（无经济奖励，纯好友推荐）
const express = require('express');
const { db } = require('../db');
const { requireUser } = require('../auth');
const { ok } = require('../util');

const router = express.Router();
router.use(requireUser);

router.get('/', (req, res) => {
  const me = req.user;
  const invited_count = db.prepare(`SELECT COUNT(*) c FROM users WHERE invited_by=?`).get(me.id).c;
  const friends = db.prepare(`SELECT id,nickname,avatar,created_at FROM users WHERE invited_by=? ORDER BY id DESC LIMIT 50`).all(me.id);
  ok(res, { invite_code: me.invite_code, invited_count, friends });
});

module.exports = router;

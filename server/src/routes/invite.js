// 邀请：邀请码、已邀请人数（无经济奖励，纯好友推荐）
const express = require('express');
const { db } = require('../db');
const { requireUser } = require('../auth');
const { ok, fail, nowTs } = require('../util');
const { pushToUser } = require('../ws');

const router = express.Router();
router.use(requireUser);

router.get('/', (req, res) => {
  const me = req.user;
  const invited_count = db.prepare(`SELECT COUNT(*) c FROM users WHERE invited_by=?`).get(me.id).c;
  const friends = db.prepare(`SELECT id,nickname,avatar,created_at FROM users WHERE invited_by=? ORDER BY id DESC LIMIT 50`).all(me.id);
  // 邀请人（注册后补填场景）：已绑定时返回昵称供页面展示
  const inviter = me.invited_by ? db.prepare(`SELECT nickname FROM users WHERE id=?`).get(me.invited_by) : null;
  ok(res, { invite_code: me.invite_code, invited_count, friends, inviter_name: inviter ? inviter.nickname : '' });
});

// 注册后补填邀请码：每人限一次（invited_by 一经绑定不可更改），不能填自己的
router.post('/bind', (req, res) => {
  const me = req.user;
  if (me.invited_by) return fail(res, '你已经绑定过邀请人了（每人限一次）');
  const code = String(req.body.code || '').trim().toUpperCase();
  if (!code) return fail(res, '请填写邀请码');
  const inviter = db.prepare(`SELECT id,nickname,invite_code FROM users WHERE invite_code=? AND id!=0`).get(code);
  if (!inviter) return fail(res, '邀请码不存在');
  if (inviter.id === me.id) return fail(res, '不能填写自己的邀请码');
  db.prepare(`UPDATE users SET invited_by=? WHERE id=? AND invited_by IS NULL`).run(inviter.id, me.id);
  db.prepare(`INSERT INTO notifications(user_id,type,title,body,created_at) VALUES(?,?,?,?,?)`)
    .run(inviter.id, 'invite_used', '邀请成功', `${me.nickname} 填写了你的邀请码，你们现在是好友啦`, nowTs());
  pushToUser(inviter.id, { t: 'notif' });
  ok(res, { inviter_name: inviter.nickname });
});

module.exports = router;

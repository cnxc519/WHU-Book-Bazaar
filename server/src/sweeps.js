// 后台定时任务：毕业年级在售书籍年度下架
// 规则：每年 8 月 10 日（北京时间）统一下架已毕业年级（入学年份 + 4 <= 当前学年）的在售书籍，
// 避免毕业离校后无人处理的旧书长期占据书市；下架书保留在卖家「我的书」中，管理员可恢复
const { db, getSettings, setSetting } = require('./db');
const { pushToUser } = require('./ws');
const { nowTs } = require('./util');
const { gradeWindow } = require('./business');

function notify(userId, type, title, body, data) {
  const r = db.prepare(`INSERT INTO notifications(user_id,type,title,body,data_json,created_at) VALUES(?,?,?,?,?,?)`)
    .run(userId, type, title, body, JSON.stringify(data || {}), nowTs());
  pushToUser(userId, { t: 'notif', n: { id: r.lastInsertRowid, type, title, body, data } });
}

// 年度下架：settings.grad_sweep_done 记录已清到的最老年级，同一学年只执行一次
// （8 月 10 日后的首个执行点触发；管理员事后恢复的书不会被反复扫掉）
function sweepGraduatedBooks() {
  try {
    const { cutoff } = gradeWindow();
    const done = parseInt(getSettings().grad_sweep_done || '0', 10) || 0;
    if (cutoff <= done) return;

    const rows = db.prepare(`
      SELECT b.id, b.title, b.seller_id
      FROM books b JOIN users u ON u.id = b.seller_id
      WHERE b.status='on' AND u.grade > 0 AND u.grade <= ?`).all(cutoff);

    for (const r of rows) {
      db.prepare(`UPDATE books SET status='off' WHERE id=? AND status='on'`).run(r.id);
    }
    setSetting('grad_sweep_done', String(cutoff));

    // 按卖家聚合发一条通知，说明规则与恢复渠道
    const bySeller = new Map();
    for (const r of rows) {
      if (!bySeller.has(r.seller_id)) bySeller.set(r.seller_id, []);
      bySeller.get(r.seller_id).push(r.title);
    }
    for (const [sellerId, titles] of bySeller) {
      const shown = titles.slice(0, 3).map((t) => `《${t}》`).join('、');
      const more = titles.length > 3 ? ` 等 ${titles.length} 本` : '';
      db.prepare(`INSERT INTO notifications(user_id,type,title,body,created_at) VALUES(?,?,?,?,?)`)
        .run(sellerId, 'grad_sweep', '在售书籍已按毕业年级政策下架',
          `按平台规则，每年 8 月 10 日统一下架毕业年级的在售书籍。你发布的 ${shown}${more} 已下架；` +
          `若你仍在读（如五年制、研究生），请通过「我的-反馈」联系我们恢复。`, nowTs());
      pushToUser(sellerId, { t: 'notif' });
    }
    if (rows.length) {
      console.log(`[sweep] 毕业年级(<= ${cutoff} 级)在售书籍已统一下架:`, rows.length, '本 /', bySeller.size, '位卖家');
    }
  } catch (e) { console.log('[sweep] 毕业年级书籍下架失败:', e.message); }
}

// 心愿时效：心愿具有学期性/时效性，发布（或重新上架）满 2 个月自动下架，
// 防止过期的求购长期挂在心愿单里；重新上架会重置发布时间（见 routes/wishes.js）
const WISH_TTL_DAYS = 60;

function sweepExpiredWishes() {
  try {
    const cutoff = new Date(nowTs() - WISH_TTL_DAYS * 86400e3).toISOString();
    const rows = db.prepare(`SELECT id, title, buyer_id FROM wishes WHERE status='on' AND created_at < ?`).all(cutoff);
    if (!rows.length) return;
    for (const w of rows) {
      db.prepare(`UPDATE wishes SET status='off' WHERE id=? AND status='on'`).run(w.id);
      notify(w.buyer_id, 'wish_expire', '心愿已到期自动下架',
        `心愿《${w.title}》发布已满 2 个月，按平台规则自动下架（心愿有学期性，过期求购会打扰大家）；如仍需要，可在「求购」页重新上架，时效重新计算`, {});
    }
    console.log('[sweep] 到期心愿自动下架:', rows.length, '条');
  } catch (e) { console.log('[sweep] 心愿到期下架失败:', e.message); }
}

function initSweeps() {
  sweepGraduatedBooks();               // 启动即补一次（覆盖停机跨过 8 月 10 日的情况）
  sweepExpiredWishes();
  setInterval(() => {
    sweepGraduatedBooks();
    sweepExpiredWishes();
  }, 3600e3);                          // 每小时巡检一次，8 月 10 日当天即可生效
}

module.exports = { initSweeps, sweepGraduatedBooks, sweepExpiredWishes };

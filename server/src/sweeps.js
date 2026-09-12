// 后台定时任务：过期内容自动下架（每小时巡检）
// - 在售书籍：上架（或重新上架）满 1 年自动下架，兼顾"不留僵尸书"与"书市信息充实"
// - 心愿：发布（或重新上架）满 2 个月自动下架（心愿有学期性/时效性）
// 下架只转状态不删数据，卖家可随时重新上架（时效重新计算）
const { db } = require('./db');
const { pushToUser } = require('./ws');
const { nowTs } = require('./util');

function notify(userId, type, title, body, data) {
  const r = db.prepare(`INSERT INTO notifications(user_id,type,title,body,data_json,created_at) VALUES(?,?,?,?,?,?)`)
    .run(userId, type, title, body, JSON.stringify(data || {}), nowTs());
  pushToUser(userId, { t: 'notif', n: { id: r.lastInsertRowid, type, title, body, data } });
}

// 在售书 1 年时效：转 off（下架书保留在卖家「我的书」，可重新上架）；管理员后台亦可恢复
const BOOK_TTL_DAYS = 365;

function sweepStaleBooks() {
  try {
    const cutoff = new Date(nowTs() - BOOK_TTL_DAYS * 86400e3).toISOString();
    const rows = db.prepare(`SELECT id, title, seller_id FROM books WHERE status='on' AND created_at < ?`).all(cutoff);
    if (!rows.length) return;
    for (const b of rows) {
      db.prepare(`UPDATE books SET status='off' WHERE id=? AND status='on'`).run(b.id);
      notify(b.seller_id, 'book_expire', '在售书籍已到期自动下架',
        `《${b.title}》已上架满 1 年，按平台规则自动下架；如仍要出售，可在「卖书」页重新上架，时效重新计算`, {});
    }
    console.log('[sweep] 到期在售书自动下架:', rows.length, '本');
  } catch (e) { console.log('[sweep] 书籍到期下架失败:', e.message); }
}

// 心愿 2 个月时效
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
  sweepStaleBooks();   // 启动即补一次（覆盖停机期间到期的情况）
  sweepExpiredWishes();
  setInterval(() => {
    sweepStaleBooks();
    sweepExpiredWishes();
  }, 3600e3);
}

module.exports = { initSweeps, sweepStaleBooks, sweepExpiredWishes };

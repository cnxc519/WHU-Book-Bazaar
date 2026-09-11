// 共享业务逻辑（纯书市版）：用户公开信息、年级规则
const { db } = require('./db');
const { chinaNow } = require('./util');

function userPublic(u) {
  const school = db.prepare(`SELECT name FROM schools WHERE id=?`).get(u.school_id);
  return {
    id: u.id, nickname: u.nickname, gender: u.gender, avatar: u.avatar,
    school: school ? school.name : '', created_at: u.created_at,
  };
}

// ---------- 年级（入学年份）规则 ----------
// 本科四年制；每年 8 月 10 日（北京时间）视为新学年起点：
// - 注册可选年级：新学年前 [Y-4, Y-1]，新学年后 [Y-3, Y]（Y=当前年份）
// - 已毕业年级：入学年份 <= cutoff（毕业年份已过当年 8 月 10 日），在售书籍统一下架且不可再发布
function gradeWindow(now = chinaNow()) {
  const y = now.getUTCFullYear();
  const md = (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
  const newTerm = md >= 810;
  return {
    min: newTerm ? y - 3 : y - 4,     // 注册可选的最老年级
    max: newTerm ? y : y - 1,         // 注册可选的最新年级（刚入学）
    cutoff: newTerm ? y - 4 : y - 5,  // 入学年份 <= cutoff 视为已毕业
  };
}

// 模糊搜索：包含 或 子序列命中（"线代"命中"线性代数"、"高数"命中"高等数学"）。
// 书市与心愿单共用
function fuzzyHit(needle, hay) {
  hay = String(hay || '').toLowerCase();
  if (!needle) return true;
  if (hay.indexOf(needle) >= 0) return true;
  let i = 0;
  for (let k = 0; k < hay.length && i < needle.length; k++) {
    if (hay[k] === needle[i]) i++;
  }
  return i >= needle.length;
}

module.exports = { userPublic, gradeWindow, fuzzyHit };

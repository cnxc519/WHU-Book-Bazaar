// 共享业务逻辑（纯书市版）：用户公开信息
const { db } = require('./db');

function userPublic(u) {
  const school = db.prepare(`SELECT name FROM schools WHERE id=?`).get(u.school_id);
  return {
    id: u.id, nickname: u.nickname, gender: u.gender, avatar: u.avatar,
    school: school ? school.name : '', created_at: u.created_at,
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

module.exports = { userPublic, fuzzyHit };

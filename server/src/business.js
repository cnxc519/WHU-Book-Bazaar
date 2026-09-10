// 共享业务逻辑（纯书市版）：用户公开信息
const { db } = require('./db');

function userPublic(u) {
  const school = db.prepare(`SELECT name FROM schools WHERE id=?`).get(u.school_id);
  return {
    id: u.id, nickname: u.nickname, gender: u.gender, avatar: u.avatar,
    school: school ? school.name : '', created_at: u.created_at,
  };
}

module.exports = { userPublic };

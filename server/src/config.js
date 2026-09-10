// 加载 config.json 并读取/写入数据库中的可调设置（管理后台可改）
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));

// 管理密码：启动时哈希一次，登录时比对
cfg.adminHash = bcrypt.hashSync(String(cfg.admin.password || 'admin888'), 10);

// 数据库可调设置
const DEFAULTS = {
  avatar_max_kb: 200,          // 头像最大 KB
};

module.exports = { cfg, DEFAULTS };

// 邮箱验证码：SMTP 发送；未配置 SMTP 或开发模式下打印到控制台
const nodemailer = require('nodemailer');
const { cfg } = require('./config');
const { code6, nowTs } = require('./util');
const { db } = require('./db');

let transporter = null;
if (cfg.smtp && cfg.smtp.host) {
  transporter = nodemailer.createTransport({
    host: cfg.smtp.host, port: cfg.smtp.port, secure: !!cfg.smtp.secure,
    auth: { user: cfg.smtp.user, pass: cfg.smtp.pass },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
  });
}

const CODE_TTL = 10 * 60 * 1000; // 10 分钟有效
const CODES_PER_DAY = 10;

// 生成并发送验证码。返回 {ok, msg}；开发模式额外返回 code。
// 正式模式会真正等待 SMTP 发送结果（15 秒超时）：发不出去就明确报错，
// 避免接口返回"已发送"但用户永远收不到邮件、验证码只躺在服务器控制台
async function sendCode(email, purpose) {
  email = String(email || '').trim().toLowerCase();

  // 当天已发数量限制
  const dayStart = nowTs() - (nowTs() % 86400000) - 8 * 3600 * 1000; // 北京自然日
  const sent = db.prepare(`SELECT COUNT(*) c FROM email_codes WHERE email=? AND purpose=? AND created_at>=?`)
    .get(email, purpose, dayStart).c;
  if (sent >= CODES_PER_DAY) return { ok: false, msg: '该邮箱今天验证码发送次数过多，请明天再试' };

  // 同一邮箱 60 秒内只发一次
  const recent = db.prepare(`SELECT created_at FROM email_codes WHERE email=? AND purpose=? ORDER BY id DESC LIMIT 1`).get(email, purpose);
  if (recent && nowTs() - recent.created_at < 60 * 1000) return { ok: false, msg: '发送过于频繁，请 60 秒后再试' };

  const code = code6();
  db.prepare(`INSERT INTO email_codes(email,code,purpose,expires_at,created_at) VALUES(?,?,?,?,?)`)
    .run(email, code, purpose, nowTs() + CODE_TTL, nowTs());

  const text = `【乐乐书市】您的验证码是 ${code}，10 分钟内有效。若非本人操作请忽略本邮件。`;
  if (transporter) {
    try {
      await Promise.race([
        transporter.sendMail({ from: cfg.mail_from, to: email, subject: '【乐乐书市】验证码', text }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('发送超时')), 15000)),
      ]);
    } catch (e) {
      console.error('[mailer] 发送失败:', e.message);
      return { ok: false, msg: '验证码邮件发送失败，请稍后重试或联系管理员' };
    }
  } else {
    console.log(`[mailer][${purpose}] 验证码 -> ${email} : ${code}`);
  }

  const r = { ok: true, msg: '验证码已发送' };
  if (cfg.dev_mode) r.code = code; // 开发模式直接返回，便于联调
  return r;
}

// 校验验证码并标记使用。返回 {ok, msg}
function verifyCode(email, purpose, code) {
  email = String(email || '').trim().toLowerCase();
  code = String(code || '').trim();
  const row = db.prepare(`SELECT * FROM email_codes WHERE email=? AND purpose=? AND used=0 ORDER BY id DESC LIMIT 1`).get(email, purpose);
  if (!row) return { ok: false, msg: '请先获取验证码' };
  if (row.expires_at < nowTs()) return { ok: false, msg: '验证码已过期，请重新获取' };
  if (row.code !== code) return { ok: false, msg: '验证码错误' };
  db.prepare(`UPDATE email_codes SET used=1 WHERE id=?`).run(row.id);
  return { ok: true, msg: 'ok' };
}

module.exports = { sendCode, verifyCode };

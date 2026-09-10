#!/usr/bin/env bash
# ============================================================
# 乐乐书市 部署脚本（在【本地电脑】运行，推荐 Git Bash）
#
# 用法：
#   bash deploy.sh        日常更新：上传代码 -> 装依赖(如有变化) -> 重启服务 -> 自检
#   bash deploy.sh init   首次部署：上述全部 + 安装 Node 24/PM2 + PM2 开机自启 + 放行端口
#
# 密码：仅【第一次运行】配置免密登录时输一次，此后部署完全免密。
# ============================================================
set -e

SERVER_IP="47.91.25.15"
SSH_USER="root"
REMOTE_DIR="/opt/lelebook/server"
PORT="8901"
APP_NAME="lelebook"

MODE="${1:-update}"
if [ "$MODE" != "update" ] && [ "$MODE" != "init" ]; then
  echo "用法: bash deploy.sh [update|init]（默认 update）"
  exit 1
fi

cd "$(dirname "$0")"

SSH_TARGET="${SSH_USER}@${SERVER_IP}"

# ---------- 免密登录：未配置则一次性完成（此后部署不再需要密码） ----------
if ! ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "$SSH_TARGET" true 2>/dev/null; then
  echo "================ 乐乐书市部署（$MODE） ================"
  echo ">> SSH 免密登录尚未配置（只需这一次输入密码，之后永久免密）"
  if [ ! -f ~/.ssh/id_ed25519 ] && [ ! -f ~/.ssh/id_rsa ]; then
    mkdir -p ~/.ssh
    ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 -q
    echo "   已生成 SSH 密钥 ~/.ssh/id_ed25519"
  fi
  ssh-copy-id -o StrictHostKeyChecking=accept-new -i ~/.ssh/id_ed25519.pub "$SSH_TARGET"
  if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_TARGET" true 2>/dev/null; then
    echo "⚠️ 免密配置未生效：请确认服务器 /root/.ssh/authorized_keys 包含你的公钥后重试"
    exit 1
  fi
  echo "✅ 免密登录配置成功"
fi

echo "================ 乐乐书市部署（$MODE） ================"
echo "目标 : $SSH_TARGET  目录: $REMOTE_DIR"

# ---------- 打包并上传（免密） ----------
TMP_TGZ="$(mktemp -u).tgz"
tar czf "$TMP_TGZ" --exclude=node_modules --exclude='data.db' --exclude='data.db-wal' \
  --exclude='data.db-shm' --exclude=uploads --exclude='*.log' \
  src admin config.json package.json package-lock.json
scp -q "$TMP_TGZ" "$SSH_TARGET:/tmp/lele-deploy.tgz"
rm -f "$TMP_TGZ"

# ---------- 远端部署 ----------
echo "== 远端部署 =="
ssh "$SSH_TARGET" "bash -s" <<REMOTE
set -e
DIR="$REMOTE_DIR"
PORT="$PORT"
APP="$APP_NAME"

tar xzf /tmp/lele-deploy.tgz -C "\$DIR"
rm -f /tmp/lele-deploy.tgz
echo "   代码已更新"

if [ "\$MODE" = "init" ]; then
  export DEBIAN_FRONTEND=noninteractive
  if ! command -v node >/dev/null 2>&1; then
    echo "   安装 Node.js 24（Ubuntu/Debian 适用）..."
    apt-get update -qq >/dev/null
    apt-get install -y -qq curl >/dev/null
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
    apt-get install -y -qq nodejs
  fi
  if ! command -v pm2 >/dev/null 2>&1; then
    npm install -g pm2 --silent
  fi
  if command -v ufw >/dev/null 2>&1; then ufw allow \$PORT/tcp >/dev/null 2>&1 || true; fi
fi

echo "   Node: \$(node -v) | 安装依赖..."
cd "\$DIR"
npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1

if pm2 restart "\$APP" --update-env >/dev/null 2>&1; then
  echo "   服务已重启"
else
  pm2 start src/index.js --name "\$APP" >/dev/null
  pm2 save >/dev/null
  echo "   服务已启动（PM2 守护）"
  pm2 startup 2>/dev/null | tail -1 || true
fi

sleep 1
PING=\$(curl -s -m 5 "http://127.0.0.1:\$PORT/api/ping" || true)
if echo "\$PING" | grep -q '"ok":true'; then
  echo "   自检通过：服务正常响应"
else
  echo "   ⚠️ 自检未通过，请执行 pm2 logs $APP 查看日志"
fi
REMOTE

echo ""
echo "=========================================="
echo " ✅ 部署完成（$MODE）"
echo "    接口检查 : http://${SERVER_IP}:${PORT}/api/ping"
echo "    管理后台 : http://${SERVER_IP}:${PORT}/admin"
echo "=========================================="
if [ "$MODE" = "init" ]; then
  echo " ⚠️ 阿里云安全组需在控制台放行 TCP ${PORT}（服务器本机防火墙已自动放行）"
fi

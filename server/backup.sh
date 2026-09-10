#!/usr/bin/env bash
# ============================================================
# 乐乐代跑 数据库备份脚本（在【服务器】上运行）
# 手动：bash backup.sh
# 自动：crontab -e 添加  0 4 * * * /bin/bash /opt/lele/server/backup.sh
# 保留最近 14 天备份
# ============================================================
DAY=$(date +%F)
BACKUP_DIR="/opt/lele/backups"
mkdir -p "$BACKUP_DIR"
cp /opt/lele/server/data.db "$BACKUP_DIR/data_${DAY}.db"
find "$BACKUP_DIR" -name 'data_*.db' -mtime +14 -delete
echo "[$(date '+%F %T')] 备份完成: $BACKUP_DIR/data_${DAY}.db"

#!/usr/bin/env bash
# Safe online SQLite backup (uses SQLite's own backup, not a raw file copy of a live WAL database).
# Cron example (daily 03:15):  15 3 * * * /opt/gridstrike/backend/deploy/backup.sh >> /var/log/gridstrike/backup.log 2>&1
set -euo pipefail
DB="${DB_PATH:-/var/lib/gridstrike/gridstrike.db}"
OUT="${BACKUP_DIR:-/var/backups/gridstrike}"
KEEP="${KEEP_DAYS:-14}"
mkdir -p "$OUT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$OUT/gridstrike-$STAMP.db"
node --no-warnings -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[1]);
db.exec(\"VACUUM INTO '\" + process.argv[2].replace(/'/g, \"''\") + \"'\");
db.close();
" "$DB" "$DEST"
gzip -f "$DEST"
find "$OUT" -name 'gridstrike-*.db.gz' -mtime +"$KEEP" -delete
echo "backup ok: $DEST.gz"

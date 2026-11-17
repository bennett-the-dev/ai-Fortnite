#!/usr/bin/env bash
# READ-ONLY inspection. Changes nothing, prints no secrets (no env vars, no file contents beyond OS release).
echo "== OS =="; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") ; uname -srm
echo "== User =="; id -un; (id -nG | tr ' ' '\n' | grep -Ex 'sudo|wheel|docker' || true)
echo "== Resources =="; free -h 2>/dev/null | sed -n '1,2p'; nproc 2>/dev/null; df -h / 2>/dev/null | tail -1
echo "== Listening ports =="; (ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null) | awk 'NR==1 || /LISTEN/ {print $1,$4}' | head -30
echo "== Installed software =="
for c in node npm nginx psql sqlite3 redis-server pm2 certbot ufw git; do
  if command -v "$c" >/dev/null 2>&1; then printf "%s: " "$c"; ("$c" --version 2>&1 || "$c" -v 2>&1) | head -1; else echo "$c: not found"; fi
done
echo "== Services (nginx/postgres/redis) =="; for s in nginx postgresql redis redis-server; do systemctl is-active "$s" 2>/dev/null | sed "s/^/$s: /"; done
echo "== Existing nginx sites (names only) =="; ls /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null

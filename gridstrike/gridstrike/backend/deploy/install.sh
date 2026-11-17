#!/usr/bin/env bash
# One-time install on a Debian/Ubuntu VPS. READ IT FIRST. It only creates NEW things (user, folders, service, nginx site)
# and refuses to overwrite files that already exist. Run as root:  sudo bash install.sh game.example.com
set -euo pipefail
DOMAIN="${1:?usage: install.sh your.domain.com}"
SRC="$(cd "$(dirname "$0")/../.." && pwd)"

command -v node >/dev/null || { echo "Node.js not found. Install Node 22+ first (see BACKEND_HOW_TO.md step 3)."; exit 1; }
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" || { echo "Node 22+ required (built-in SQLite)."; exit 1; }

id gridstrike >/dev/null 2>&1 || useradd --system --home /opt/gridstrike --shell /usr/sbin/nologin gridstrike
mkdir -p /opt/gridstrike /var/lib/gridstrike /var/log/gridstrike /etc/gridstrike
cp -r "$SRC"/{backend,client,config,src,package.json} /opt/gridstrike/
chown -R gridstrike:gridstrike /opt/gridstrike /var/lib/gridstrike /var/log/gridstrike

if [ ! -e /etc/gridstrike/gridstrike.env ]; then
  cp "$SRC/backend/deploy/.env.example" /etc/gridstrike/gridstrike.env
  chown gridstrike:gridstrike /etc/gridstrike/gridstrike.env; chmod 600 /etc/gridstrike/gridstrike.env
else echo "kept existing /etc/gridstrike/gridstrike.env"; fi

if [ ! -e /etc/systemd/system/gridstrike.service ]; then cp "$SRC/backend/deploy/gridstrike.service" /etc/systemd/system/; else echo "kept existing service file"; fi

SITE=/etc/nginx/sites-available/gridstrike
if [ -d /etc/nginx/sites-available ] && [ ! -e "$SITE" ]; then
  sed "s/game.example.com/$DOMAIN/g" "$SRC/backend/deploy/nginx-gridstrike.conf" > "$SITE"
  echo 'limit_req_zone $binary_remote_addr zone=gs_auth:10m rate=10r/m;' > /etc/nginx/conf.d/gridstrike-limits.conf
  ln -sf "$SITE" /etc/nginx/sites-enabled/gridstrike
  nginx -t && systemctl reload nginx
else echo "nginx site not written (already exists or no sites-available). Add it by hand from backend/deploy/nginx-gridstrike.conf"; fi

systemctl daemon-reload
systemctl enable --now gridstrike
sleep 1; curl -fsS http://127.0.0.1:3000/api/health && echo
echo "Next: HTTPS ->  sudo certbot --nginx -d $DOMAIN"

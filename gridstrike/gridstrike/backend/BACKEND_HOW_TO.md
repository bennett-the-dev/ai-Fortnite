# BACKEND: what it is and how to put it on your VPS

Plain-language guide. Do the steps in order. Anything that changes your server is marked **[CHANGES SERVER]**. Never paste passwords or keys into chat.

## 0. Honest status
| Part | State |
|---|---|
| Accounts, login, sessions, password hashing | built, **automated tests pass** |
| BOLTS, ledger, rewards, daily login, STORE rotation, purchases, wardrobe equip, settings | built, **tests pass** |
| WebSocket server + authoritative build rooms (place / edit / reset / contested replacement / ping) | built, **tests pass** over real sockets |
| Latency / jitter / loss simulation (0-200 ms) | built, **tests pass** |
| Nginx config, systemd service, install script, backup script | written; backup + server process tested here; **Nginx/systemd/install.sh NOT tested on a real server** (no VPS access from here) |
| Matchmaking, game modes, combat, ranked, season track, leaderboards | **not built** (no weapons/combat exist yet) |
| Account recovery by email | **not built** (needs an email service) |
| `awardMatch()` (pays BOLTS/XP) | built + tested, but **nothing calls it yet**; the future game server will call it |

Tech: Node 22+ only, **no npm packages** (built-in `node:sqlite`, own WebSocket server). That means nothing to `npm install` and nothing to go out of date, but `node:sqlite` is marked experimental by Node; pin your Node version and test before upgrading it.

## 1. How the pieces fit
```
Browser --HTTPS/WSS--> Nginx (your VPS, port 443) --> Node backend (127.0.0.1:3000) --> SQLite file
```
- Node listens on `127.0.0.1` only. The internet never talks to it directly; Nginx does.
- The browser asks, the server decides. The browser can **never** send a balance, an owned item, or a match result. Money only changes inside `backend/lib/economy.js`, in a database transaction, with a ledger row.
- Static game files are served from `/client`, `/src/shared`, `/config` only. `backend/`, `data/` and `.env` are never public (tested).

## 2. Before you start (what you need)
1. A VPS running Debian or Ubuntu with root/sudo access (other Linux works but the script assumes `apt` style paths).
2. A domain (e.g. `play.yourname.com`) with an **A record pointing to your VPS IP**. HTTPS certificates need this. IP-only HTTPS is not practical for browsers.
3. Ports 80 and 443 open in the VPS firewall / provider panel.

## 3. Inspect first (read-only)
Run `scripts/inspect-vps.sh` on the VPS and read the output. It shows OS, RAM, disk, open ports, and whether Node/Nginx are already installed. If Nginx already hosts other sites, `install.sh` adds **one new site file** and does not edit your existing ones. If you want me to adapt commands to your server, paste that output here.

## 4. Install Node 22 **[CHANGES SERVER]**
Debian/Ubuntu example (check the current instructions at https://github.com/nodesource/distributions before running):
```
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx
node --version     # must say v22 or higher
```

## 5. Upload the project
From your own computer (replace user and IP):
```
scp gridstrike.zip youruser@YOUR_VPS_IP:~
ssh youruser@YOUR_VPS_IP
unzip gridstrike.zip && cd gridstrike
node --test        # optional but recommended: all tests should pass on the server too
```

## 6. Run the installer **[CHANGES SERVER]**
```
sudo bash backend/deploy/install.sh play.yourname.com
```
It: creates a locked-down `gridstrike` system user, copies the app to `/opt/gridstrike`, creates `/var/lib/gridstrike` (database) and `/etc/gridstrike/gridstrike.env` (settings, mode 600), installs the systemd service (auto-restart), adds an Nginx site for your domain, and checks `/api/health`. It refuses to overwrite files that already exist.

## 7. Turn on HTTPS **[CHANGES SERVER]**
```
sudo certbot --nginx -d play.yourname.com
```
Certbot edits that one Nginx site to add the 443 block and sets up auto-renewal. Then open `https://play.yourname.com/api/health`; you should see `{"ok":true,...}`.

## 8. Firewall (if you use ufw) **[CHANGES SERVER]**
```
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```
Run the first command **before** enabling or you can lock yourself out of SSH. Do not open port 3000.

## 9. Backups **[CHANGES SERVER]**
`sudo crontab -e` and add:
```
15 3 * * * DB_PATH=/var/lib/gridstrike/gridstrike.db /opt/gridstrike/backend/deploy/backup.sh >> /var/log/gridstrike/backup.log 2>&1
```
Daily compressed copy in `/var/backups/gridstrike`, 14 days kept. Backups on the same disk do not survive losing the server: copy them off-box (`scp`/`rsync`) regularly. Test a restore once: `gunzip -c file.db.gz > restored.db`.

## 10. Everyday operations
| Task | Command |
|---|---|
| Logs | `journalctl -u gridstrike -f` |
| Restart | `sudo systemctl restart gridstrike` |
| Status | `systemctl status gridstrike` and `curl https://play.yourname.com/api/health` |
| Update the game | upload new zip, `sudo bash backend/deploy/install.sh play.yourname.com` (keeps your env + DB), `sudo systemctl restart gridstrike` |
| Test latency | add `NET_LATENCY_MS=100` (also `NET_JITTER_MS`, `NET_LOSS=0.02`) to `/etc/gridstrike/gridstrike.env`, restart. Remove for production. |

## 11. Admin-configurable rewards and store
Create `/etc/gridstrike/config.json` (set `GS_CONFIG_FILE` in the env file, already in the example). Only keys you list are changed:
```json
{ "rewards": { "perElimination": 5, "perWin": 25, "daily": 20, "multiElim": { "threshold": 5, "bonus": 10 } },
  "store":   { "dailyCount": 4, "featuredCount": 2 },
  "limits":  { "authPerMinute": 10 } }
```
Restart after editing. The catalog itself lives in `backend/lib/catalog.js` (item id, slot, name, rarity, price, `rotating`). The shop rotates every UTC day and is computed from the date, so every server instance agrees.

## 12. API reference (JSON; `Authorization: Bearer <token>` except register/login/health)
| Route | Purpose |
|---|---|
| `GET /api/health` | liveness + DB check |
| `POST /api/register` `{username,password}` | 3-16 letters/digits/_ ; password 8-128. Returns token + profile. Starter OUTFIT and HARVEST TOOL granted. |
| `POST /api/login` | returns token (14-day session) |
| `POST /api/logout`, `POST /api/password` | invalidate session / change password (signs out everywhere) |
| `GET /api/me`, `GET /api/ledger` | profile, inventory, equipped, stats / BOLTS transaction history |
| `POST /api/daily` | once per UTC day |
| `GET /api/store`, `POST /api/store/purchase` `{itemId}` | today's shop / buy (server checks stock, ownership, balance) |
| `POST /api/wardrobe/equip` `{itemId}` | equip an owned item |
| `GET/PUT /api/settings` | per-account preferences only (never money or items) |

**WebSocket** `wss://play.yourname.com/ws`: first message must be `{"t":"auth","token":"...","room":"lab","style":"competitive"}` within 5 s or the socket is closed. Then:
`{"t":"place","seq":1,"req":{"type":"wall","gx":0,"gl":0,"gz":0,"o":0,"mat":"wood"}}`, `{"t":"edit","key":"W0,0,0,0","removed":[4]}`, `{"t":"reset","key":"..."}`, `{"t":"ping","ts":123}`.
Server replies: `joined` (full world snapshot), `place`, `edit`, `pending` (you entered a contested replacement window), `rej` (with a reason), `pong`. Close codes: 4001 not authenticated, 4008 message flood, 4000 replaced by a newer connection.

## 13. Security built in (and tested)
scrypt password hashes with per-user salt; session tokens stored only as SHA-256 hashes; same error for unknown user and wrong password; rate limits on API and auth (also at Nginx); 16 KB body limit; parameterised SQL everywhere; DB constraint refuses negative balances; unique ledger index makes rewards idempotent (a replayed match pays nothing); purchases are one transaction; static server whitelists three folders; WebSocket auth timeout, flood limit, per-IP connection cap, 64 KB frame cap; systemd sandboxing.

## 14. Known gaps (do these before a public launch)
- No email/recovery flow, no username change, no admin panel (edit config + use SQLite directly).
- Account/IP bans, CAPTCHA, and anti-cheat beyond server authority are not built. Combat does not exist yet, so combat validation and lag compensation are not built either.
- SQLite is single-server. It is fine for a few thousand players on one VPS; move to PostgreSQL if you need several game servers.
- Add a Content-Security-Policy header once the client's script sources are final (it currently loads Three.js from a CDN).
- Have a professional review security and branding before real public launch. This is not legal or security-audit advice.

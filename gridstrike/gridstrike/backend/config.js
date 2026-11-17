// Backend tunables. Admin-configurable: drop a JSON file at data/config.json (or set GS_CONFIG_FILE) to override any key.
// Secrets never live here; they come from environment variables (see .env.example).
import { readFileSync, existsSync } from 'node:fs';

export const DEFAULTS = {
  rewards: {
    perElimination: 5,
    perWin: 25,
    multiElim: { threshold: 5, bonus: 10 }, // extra bolts when a player gets >= threshold eliminations in one match
    daily: 20,
    xpPerElimination: 10,
    xpPerWin: 50,
    xpPerMatch: 20,
  },
  limits: {
    maxBodyBytes: 16 * 1024,
    sessionDays: 14,
    authPerMinute: 10,
    apiPerMinute: 120,
    wsMessagesPerSecond: 60,
    maxConnectionsPerIp: 8,
  },
  store: { dailyCount: 4, featuredCount: 2 },
  net: { latencyMs: 0, jitterMs: 0, loss: 0 }, // server-side network simulation (0, 20, 40 ... 200 ms)
};

const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof a[k] === 'object' ? merge(a[k], v) : v;
  return out;
};

export function loadConfig(file = process.env.GS_CONFIG_FILE || 'data/config.json') {
  let cfg = DEFAULTS;
  if (existsSync(file)) cfg = merge(DEFAULTS, JSON.parse(readFileSync(file, 'utf8')));
  if (process.env.NET_LATENCY_MS) cfg = merge(cfg, { net: { latencyMs: Number(process.env.NET_LATENCY_MS) } });
  if (process.env.NET_JITTER_MS) cfg = merge(cfg, { net: { jitterMs: Number(process.env.NET_JITTER_MS) } });
  if (process.env.NET_LOSS) cfg = merge(cfg, { net: { loss: Number(process.env.NET_LOSS) } });
  return cfg;
}

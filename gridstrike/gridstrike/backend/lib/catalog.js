// Original cosmetics catalog + deterministic daily rotation. Admin can replace this list (see BACKEND_HOW_TO.md).
// Placeholder items: names and prices are examples, no art exists yet.
import { mulberry32 } from '../../src/shared/util.js';

export const SLOTS = ['outfit', 'backGear', 'harvestTool', 'wings', 'gesture', 'weaponFinish'];

export const CATALOG = [
  { id: 'outfit_rookie',   slot: 'outfit',      name: 'Rookie Builder',   rarity: 'Common',    price: 0,    rotating: false, starter: true },
  { id: 'tool_wrench',     slot: 'harvestTool', name: 'Field Wrench',     rarity: 'Common',    price: 0,    rotating: false, starter: true },
  { id: 'outfit_circuit',  slot: 'outfit',      name: 'Circuit Runner',   rarity: 'Uncommon',  price: 300,  rotating: true },
  { id: 'outfit_ember',    slot: 'outfit',      name: 'Ember Guard',      rarity: 'Rare',      price: 800,  rotating: true },
  { id: 'outfit_glacier',  slot: 'outfit',      name: 'Glacier Warden',   rarity: 'Epic',      price: 1200, rotating: true },
  { id: 'outfit_umbra',    slot: 'outfit',      name: 'Umbra Sentinel',   rarity: 'Legendary', price: 1800, rotating: true },
  { id: 'outfit_prism',    slot: 'outfit',      name: 'Prism Phantom',    rarity: 'Mythic',    price: 2500, rotating: true },
  { id: 'tool_hammer',     slot: 'harvestTool', name: 'Forge Hammer',     rarity: 'Uncommon',  price: 400,  rotating: true },
  { id: 'tool_pick',       slot: 'harvestTool', name: 'Crystal Pick',     rarity: 'Rare',      price: 700,  rotating: true },
  { id: 'wings_paper',     slot: 'wings',       name: 'Paper Wings',      rarity: 'Common',    price: 150,  rotating: true },
  { id: 'wings_halo',      slot: 'wings',       name: 'Halo Glide',       rarity: 'Epic',      price: 1000, rotating: true },
  { id: 'gesture_wave',    slot: 'gesture',     name: 'Quick Wave',       rarity: 'Common',    price: 100,  rotating: true },
  { id: 'gesture_flex',    slot: 'gesture',     name: 'Power Pose',       rarity: 'Rare',      price: 500,  rotating: true },
  { id: 'back_pack',       slot: 'backGear',    name: 'Scout Pack',       rarity: 'Uncommon',  price: 250,  rotating: true },
  { id: 'finish_carbon',   slot: 'weaponFinish', name: 'Carbon Weave',    rarity: 'Rare',      price: 600,  rotating: true },
];

export const itemById = (id) => CATALOG.find((i) => i.id === id);
export const dayNumber = (now = Date.now()) => Math.floor(now / 864e5);

/** Same input -> same shop, so every server instance agrees and the client cannot invent a shop. */
export function rotation(now = Date.now(), cfg = { dailyCount: 4, featuredCount: 2 }) {
  const day = dayNumber(now);
  const rng = mulberry32(day * 2654435761);
  const pool = CATALOG.filter((i) => i.rotating);
  const order = [...pool];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const featured = order.slice(0, cfg.featuredCount).map((i) => i.id);
  const daily = order.slice(cfg.featuredCount, cfg.featuredCount + cfg.dailyCount).map((i) => i.id);
  const nextRotationAt = (day + 1) * 864e5;
  return { day, featured, daily, nextRotationAt };
}

export const inStore = (id, now, cfg) => { const r = rotation(now, cfg); return r.featured.includes(id) || r.daily.includes(id); };

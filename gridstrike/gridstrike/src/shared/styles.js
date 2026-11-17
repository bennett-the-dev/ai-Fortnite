// Building styles: Classic, Competitive, Shell. Behaviour flags live in config/game.js; macros live here.

/** Boxing up: four walls around a cell plus a cone overhead (shell style). Returns ordered placement requests. */
export function boxUpPlan(gx, gl, gz, mat = 'wood') {
  return [
    { type: 'wall', gx, gl, gz, o: 0, mat },         // north
    { type: 'wall', gx, gl, gz: gz + 1, o: 0, mat }, // south
    { type: 'wall', gx, gl, gz, o: 1, mat },         // west
    { type: 'wall', gx: gx + 1, gl, gz, o: 1, mat }, // east
    { type: 'cone', gx, gl: gl + 1, gz, mat },       // overhead
  ];
}

/** Execute a plan through the normal place() path so rate limits and validation still apply. */
export function runPlan(world, player, plan, startTime) {
  const gap = world.cfg.styles[player.style || 'classic'].minPlaceGap;
  const results = [];
  let t = startTime;
  for (const req of plan) {
    let res = world.place(player, req, t);
    if (!res.ok && res.reason === 'rate') { t += gap; res = world.place(player, req, t); }
    results.push(res);
    t += gap;
  }
  return { results, endTime: t };
}

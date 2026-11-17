// Server-side network simulation: wraps a send function so outgoing packets really get delayed, jittered and dropped.
// Used for the 0/20/40/60/80/100/150/200 ms test matrix (set NET_LATENCY_MS etc. or config.net).
export function simulate(send, { latencyMs = 0, jitterMs = 0, loss = 0, rng = Math.random, setT = setTimeout } = {}) {
  if (!latencyMs && !jitterMs && !loss) return send;
  return (msg) => {
    if (loss > 0 && rng() < loss) return;
    const d = Math.max(0, latencyMs + (jitterMs ? (rng() * 2 - 1) * jitterMs : 0));
    setT(() => send(msg), d);
  };
}

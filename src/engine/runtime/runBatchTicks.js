export function runBatchTicks(session, count, options = {}) {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return { ticksProcessed: 0, results: [], events: [] };
  const events = [];
  const collect = options.collectEvents !== false;
  const drain = options.drainEvents !== false;
  if (collect && options.onEvent) {
    for (let i = 0; i < n; i++) {
      const result = session.tick();
      const drained = drain ? (session.drainEvents?.() || []) : [];
      events.push(...drained);
      if (result?.meltdown) break;
    }
    return { ticksProcessed: events.length ? session.engine.tickCount : n, results: [], events };
  }
  const results = session.runTicks(n);
  return {
    ticksProcessed: results.length,
    results,
    events: drain ? (session.drainEvents?.() || []) : [],
  };
}

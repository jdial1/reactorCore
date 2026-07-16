export function placedCountKey(type, level) {
  return `${type}:${level ?? 1}`;
}

export function getPlacedCount(counts, type, level) {
  if (!counts) return 0;
  return counts[placedCountKey(type, level)] || 0;
}

export function incrementPlacedCount(counts, type, level, amount = 1) {
  const next = counts && typeof counts === 'object' ? counts : {};
  const key = placedCountKey(type, level);
  const delta = Number(amount);
  if (!Number.isFinite(delta) || delta === 0) return next;
  next[key] = (next[key] || 0) + delta;
  return next;
}

export function rebuildPlacedCountsFromGrid(grid) {
  const counts = {};
  if (!grid?.forEach) return counts;
  grid.forEach((_, __, inst) => {
    const def = inst?.definition;
    if (!def?.type) return;
    const key = placedCountKey(def.type, def.level ?? 1);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

export function clearPlacedCounts(counts) {
  if (!counts) return {};
  for (const key of Object.keys(counts)) delete counts[key];
  return counts;
}

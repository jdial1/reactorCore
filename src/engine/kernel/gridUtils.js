export function toNum(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toNumber === 'function') return value.toNumber();
  return Number(value) || 0;
}

export function countById(grid, id, activeOnly = false) {
  let count = 0;
  grid.forEach((_, __, inst) => {
    if (inst?.definition?.id === id && (!activeOnly || inst.ticks > 0)) count++;
  });
  return count;
}

export const CARDINAL_OFFSETS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export function neighborInstances(grid, row, col, offsets = CARDINAL_OFFSETS) {
  const out = [];
  for (const [dr, dc] of offsets) {
    const n = grid.getComponentAt(row + dr, col + dc);
    if (n) out.push(n);
  }
  return out;
}

export function createSustainedTracker() {
  const trackers = new Map();
  return {
    track(key, active, threshold) {
      const tracker = trackers.get(key) || { consecutiveTicks: 0 };
      if (active) tracker.consecutiveTicks += 1;
      else tracker.consecutiveTicks = 0;
      trackers.set(key, tracker);
      return {
        completed: tracker.consecutiveTicks >= threshold,
        progress: tracker.consecutiveTicks,
      };
    },
    get(key) {
      return trackers.get(key)?.consecutiveTicks ?? 0;
    },
    reset(key) {
      if (key == null) trackers.clear();
      else trackers.delete(key);
    },
    serialize() {
      const out = {};
      for (const [key, value] of trackers) out[key] = value.consecutiveTicks;
      return out;
    },
    deserialize(data) {
      trackers.clear();
      if (!data) return;
      for (const key of Object.keys(data)) {
        trackers.set(key, { consecutiveTicks: data[key] ?? 0 });
      }
    },
  };
}

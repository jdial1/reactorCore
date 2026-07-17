import { topologyNeighborCoords } from '../kernel/neighborTopology.js';
import { isValidGridCoord } from '../kernel/gridUtils.js';

function numericStat(def, ...keys) {
  for (let i = 0; i < keys.length; i++) {
    const value = def?.[keys[i]];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

function toNeighborEntry(row, col, inst, activated) {
  const def = inst.definition;
  return {
    row,
    col,
    id: def.id,
    type: def.type,
    level: def.level ?? 1,
    category: def.category,
    ticks: inst.ticks,
    containment: numericStat(def, 'containment', 'maxHeat'),
    vent: numericStat(def, 'vent'),
    transfer: numericStat(def, 'transferRate', 'transfer'),
    activated,
  };
}

function isContainmentNeighbor(def) {
  if (!def) return false;
  const containment = numericStat(def, 'containment', 'maxHeat');
  if (containment > 0) return true;
  return def.category === 'heat_exchanger'
    || def.category === 'heat_outlet'
    || def.category === 'heat_inlet';
}

export function queryNeighbors(grid, row, col, options = {}) {
  const empty = { containment: [], cell: [], reflector: [] };
  if (!grid || !isValidGridCoord(row, col, grid)) return empty;
  const center = grid.getComponentAt(row, col);
  if (!center?.definition) return empty;

  const def = center.definition;
  const topologyType = options.topologyType ?? def.topologyType ?? 'Manhattan';
  const range = options.range != null ? options.range : (def.range ?? 1);
  const coords = topologyNeighborCoords(
    topologyType,
    row,
    col,
    range,
    grid.rows,
    grid.cols,
  );

  const containment = [];
  const cell = [];
  const reflector = [];

  for (let i = 0; i < coords.length; i++) {
    const [nr, nc] = coords[i];
    const inst = grid.getComponentAt(nr, nc);
    if (!inst?.definition || inst.pendingDestruction) continue;
    const activated = grid.tileHeatMap?.isActivated?.(nr, nc) ?? true;
    if (!activated) continue;
    const ndef = inst.definition;
    const entry = toNeighborEntry(nr, nc, inst, activated);
    if (isContainmentNeighbor(ndef)) containment.push(entry);
    if (ndef.category === 'cell' && inst.ticks > 0) cell.push(entry);
    if (ndef.category === 'reflector') reflector.push(entry);
  }

  return { containment, cell, reflector };
}

export function countNeighborCategoryLevels(grid, row, col, category, options = {}) {
  if (!category) return 0;
  const { containment } = queryNeighbors(grid, row, col, options);
  let total = 0;
  for (let i = 0; i < containment.length; i++) {
    const neighbor = containment[i];
    if (neighbor.category === category) total += neighbor.level || 1;
  }
  return total;
}

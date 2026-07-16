import {
  computeGridMultiplierBonuses,
  resolveContainment,
  resolveTransferRate,
  resolveVentRate,
} from './effectiveRates.js';

const OFFSETS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const TRANSFER_CATEGORIES = new Set(['heat_exchanger', 'heat_inlet', 'heat_outlet', 'valve']);

function isContainmentNode(inst) {
  if (!inst) return false;
  const def = inst.definition;
  if ((def.containment || 0) > 0) return true;
  const cat = def.category;
  return cat === 'heat_exchanger' || cat === 'heat_inlet' || cat === 'heat_outlet' || cat === 'valve';
}

function find(parent, i) {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

function union(parent, a, b) {
  const ra = find(parent, a);
  const rb = find(parent, b);
  if (ra !== rb) parent[rb] = ra;
}

export function buildContainmentSegments(grid, options = {}) {
  const modifiers = options.modifiers || {};
  const bonuses = options.bonuses || computeGridMultiplierBonuses(grid, modifiers);
  const nodes = [];
  const indexOf = new Map();

  grid.forEach((row, col, inst) => {
    if (!isContainmentNode(inst)) return;
    const key = `${row},${col}`;
    indexOf.set(key, nodes.length);
    const containment = resolveContainment(inst);
    const heat = grid.getTileHeat(row, col) || 0;
    const category = inst.definition.category;
    nodes.push({
      row,
      col,
      id: inst.definition.id,
      category,
      containment,
      heat,
      fullness: containment > 0 ? heat / containment : 0,
      ventRate: category === 'vent' ? resolveVentRate(inst, bonuses) : 0,
      transferRate: TRANSFER_CATEGORIES.has(category) ? resolveTransferRate(inst, bonuses) : 0,
    });
  });

  const parent = nodes.map((_, i) => i);
  for (let i = 0; i < nodes.length; i++) {
    const { row, col } = nodes[i];
    for (const [dr, dc] of OFFSETS) {
      const key = `${row + dr},${col + dc}`;
      const j = indexOf.get(key);
      if (j != null) union(parent, i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < nodes.length; i++) {
    const root = find(parent, i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(nodes[i]);
  }

  return [...groups.values()].map((tiles) => {
    let totalHeat = 0;
    let totalContainment = 0;
    let totalVentRate = 0;
    let totalTransferRate = 0;
    for (const tile of tiles) {
      totalHeat += tile.heat;
      totalContainment += tile.containment;
      totalVentRate += tile.ventRate;
      totalTransferRate += tile.transferRate;
    }
    return {
      tiles,
      totalHeat,
      totalContainment,
      totalVentRate,
      totalTransferRate,
      pressure: totalContainment > 0 ? totalHeat / totalContainment : 0,
      fullness: totalContainment > 0 ? totalHeat / totalContainment : 0,
    };
  });
}

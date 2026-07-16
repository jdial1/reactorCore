import { CARDINAL_OFFSETS } from '../kernel/gridUtils.js';

function numericStat(def, ...keys) {
  for (let i = 0; i < keys.length; i++) {
    const value = def?.[keys[i]];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

export function classifyActivePart(inst, { row, col, grid } = {}) {
  if (!inst?.definition || inst.pendingDestruction) {
    return {
      cells: false,
      inlets: false,
      exchangers: false,
      valves: false,
      outlets: false,
      vents: false,
      capacitors: false,
      vessels: false,
    };
  }
  const def = inst.definition;
  const category = def.category;
  const vent = numericStat(def, 'vent');
  const transfer = numericStat(def, 'transferRate', 'transfer');
  const containment = numericStat(def, 'containment', 'maxHeat');
  const activated = grid?.tileHeatMap?.isActivated?.(row, col) ?? true;
  const cells = category === 'cell' && inst.ticks > 0;
  const inlets = category === 'heat_inlet';
  const exchangers = category === 'heat_exchanger'
    || category === 'valve'
    || (category === 'reactor_plating' && transfer > 0);
  const valves = category === 'valve';
  const outlets = category === 'heat_outlet' && activated;
  const vents = category === 'vent';
  const capacitors = category === 'capacitor';
  const vessels = category === 'vent'
    || vent > 0
    || category === 'particle_accelerator'
    || (containment > 0 && category !== 'valve');
  return { cells, inlets, exchangers, valves, outlets, vents, capacitors, vessels };
}

function toActiveEntry(row, col, inst, activated) {
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

function buildValveNeighborKeys(activeValves, grid) {
  const keys = new Set();
  for (let i = 0; i < activeValves.length; i++) {
    const valve = activeValves[i];
    for (let j = 0; j < CARDINAL_OFFSETS.length; j++) {
      const [dr, dc] = CARDINAL_OFFSETS[j];
      const nr = valve.row + dr;
      const nc = valve.col + dc;
      const neighbor = grid.getComponentAt(nr, nc);
      if (!neighbor?.definition) continue;
      if (neighbor.definition.category === 'valve') continue;
      keys.add(`${nr},${nc}`);
    }
  }
  return keys;
}

export function deriveActiveParts(grid) {
  const active_cells = [];
  const active_vessels = [];
  const active_inlets = [];
  const active_exchangers = [];
  const active_outlets = [];
  const active_valves = [];
  const active_vents = [];
  const active_capacitors = [];

  grid.forEach((row, col, inst) => {
    if (!inst?.definition || inst.pendingDestruction) return;
    const activated = grid.tileHeatMap?.isActivated?.(row, col) ?? true;
    const kinds = classifyActivePart(inst, { row, col, grid });
    const entry = toActiveEntry(row, col, inst, activated);
    if (kinds.cells) active_cells.push(entry);
    if (kinds.inlets) active_inlets.push(entry);
    if (kinds.exchangers) active_exchangers.push(entry);
    if (kinds.valves) active_valves.push(entry);
    if (kinds.outlets) active_outlets.push(entry);
    if (kinds.vents) active_vents.push(entry);
    if (kinds.capacitors) active_capacitors.push(entry);
    if (kinds.vessels) active_vessels.push(entry);
  });

  return {
    active_cells,
    active_vessels,
    active_inlets,
    active_exchangers,
    active_outlets,
    active_valves,
    active_vents,
    active_capacitors,
    cells: active_cells,
    vessels: active_vessels,
    inlets: active_inlets,
    exchangers: active_exchangers,
    outlets: active_outlets,
    valves: active_valves,
    vents: active_vents,
    capacitors: active_capacitors,
    valveNeighborKeys: buildValveNeighborKeys(active_valves, grid),
  };
}

export function getActivePartList(grid, key) {
  const derived = deriveActiveParts(grid);
  return derived[key] ?? [];
}

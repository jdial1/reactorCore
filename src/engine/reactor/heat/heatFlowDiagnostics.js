import {
  computeGridMultiplierBonuses,
  resolveContainment,
} from './effectiveRates.js';
import { CARDINAL_OFFSETS } from '../../kernel/gridUtils.js';

const FLOW_KINDS = new Set(['heat_exchanger', 'heat_inlet', 'heat_outlet']);

function neighborContainmentPressure(grid, row, col) {
  const inst = grid.getComponentAt(row, col);
  if (!inst) return null;
  const cap = resolveContainment(inst);
  if (!(cap > 0) && !FLOW_KINDS.has(inst.definition?.category) && inst.definition?.category !== 'valve') {
    return null;
  }
  const containment = cap || 1;
  const heat = grid.getTileHeat(row, col) || 0;
  return { row, col, pressure: heat / containment, pressurePct: (heat / containment) * 100, containment, heat };
}

export function getTileFlowDiagnostics(grid, row, col, options = {}) {
  const inst = grid.getComponentAt(row, col);
  if (!inst) return null;
  const kind = inst.definition?.category;
  if (!FLOW_KINDS.has(kind)) return null;

  const cap = resolveContainment(inst) || 1;
  const heat = grid.getTileHeat(row, col) || 0;
  const pressureStart = heat / cap;
  const pressurePct = pressureStart * 100;
  const neighbors = [];
  let maxNeighborPct = 0;
  let blocked = false;

  for (const [dr, dc] of CARDINAL_OFFSETS) {
    const nb = neighborContainmentPressure(grid, row + dr, col + dc);
    if (!nb) continue;
    const status = pressureStart <= nb.pressure ? 'blocked_by_pressure' : 'flowing';
    if (status === 'blocked_by_pressure') blocked = true;
    if (nb.pressurePct > maxNeighborPct) maxNeighborPct = nb.pressurePct;
    neighbors.push({
      row: nb.row,
      col: nb.col,
      pressurePct: nb.pressurePct,
      status,
    });
  }

  let summary;
  if (neighbors.length === 0) {
    summary = 'No containment neighbors — heat cannot route';
  } else if (blocked) {
    const blockedNb = neighbors.find((n) => n.status === 'blocked_by_pressure');
    summary = `Blocked: your ${pressurePct.toFixed(0)}% ≤ neighbor ${blockedNb.pressurePct.toFixed(0)}%`;
  } else {
    summary = `Flow OK: ${pressurePct.toFixed(0)}% vs max neighbor ${maxNeighborPct.toFixed(0)}%`;
  }

  return {
    kind,
    pressurePct,
    neighbors,
    summary,
    bonuses: options.bonuses || null,
  };
}

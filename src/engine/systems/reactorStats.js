import { isBroken } from '../reactor/createInstance.js';
import { computeNeighborPulseN, computeCellOutput } from '../reactor/phases/cellPhase.js';
import { CARDINAL_OFFSETS } from '../kernel/gridUtils.js';

const HEAT_POWER_LOG_BASE = 1000;
const HEAT_POWER_LOG_CAP = 1e100;
const HEAT_POWER_PERCENT_DIVISOR = 100;

function heatPowerMultiplier(hpm, currentHeat) {
  if (!hpm || hpm <= 0 || !currentHeat || currentHeat <= 0) return 1;
  const heatNum = Math.min(currentHeat, HEAT_POWER_LOG_CAP);
  const mult = 1 + hpm * (Math.log(heatNum) / Math.log(HEAT_POWER_LOG_BASE) / HEAT_POWER_PERCENT_DIVISOR);
  return Number.isFinite(mult) && mult > 0 ? mult : 1;
}

function resolveVentRate(inst) {
  if (typeof inst._effectiveVent === 'number' && Number.isFinite(inst._effectiveVent)) {
    return inst._effectiveVent;
  }
  const def = inst.definition;
  return def.vent ?? def.baseVent ?? 0;
}

function countActiveReflectorNeighbors(grid, row, col) {
  let count = 0;
  for (const [dr, dc] of CARDINAL_OFFSETS) {
    const neighbor = grid.getComponentAt(row + dr, col + dc);
    if (neighbor && !isBroken(neighbor) && neighbor.definition.category === 'reflector' && neighbor.ticks > 0) count++;
  }
  return count;
}

export function deriveReactorStats(grid, modifiers = {}, options = {}) {
  const overrides = options.mechanicsOverrides || {};
  const reflectorCooling = overrides.reflectorCoolingFactor ?? modifiers.reflectorCoolingFactor ?? 0;
  const stirlingMult = overrides.stirlingMultiplier ?? modifiers.stirlingMultiplier ?? 0;
  const heatPowerMult = overrides.heatPowerMultiplier ?? modifiers.heatPowerMultiplier ?? 0;
  const heatBoost = heatPowerMultiplier(heatPowerMult, grid.currentHeat || 0);

  let cellPower = 0;
  let heatGeneration = 0;
  let vent = 0;
  let inlet = 0;
  let outlet = 0;
  let totalPartHeat = 0;

  grid.forEach((row, col, inst) => {
    if (!inst || isBroken(inst) || inst.pendingDestruction) return;
    const def = inst.definition;
    totalPartHeat += grid.getTileHeat(row, col) || 0;

    if (def.category === 'cell' && inst.ticks > 0) {
      const m = def.cellMultiplier ?? def.pulseMultiplier ?? 1;
      const pulse = m + computeNeighborPulseN(grid, row, col);
      const reflectors = countActiveReflectorNeighbors(grid, row, col);
      const { layoutPower, generatedHeat } = computeCellOutput(def, inst, pulse, reflectors, reflectorCooling, 1);
      cellPower += layoutPower * heatBoost;
      heatGeneration += generatedHeat;
    } else if (def.category === 'vent') {
      vent += resolveVentRate(inst);
    } else if (def.category === 'heat_inlet') {
      inlet += inst._effectiveTransfer ?? def.transfer ?? def.transferRate ?? 0;
    } else if (def.category === 'heat_outlet') {
      outlet += inst._effectiveTransfer ?? def.transfer ?? def.transferRate ?? 0;
    }
  });

  const stirlingPower = stirlingMult > 0 ? vent * stirlingMult : 0;
  const autoSellPercent = options.autoSellPercent ?? modifiers.autoSellPercent ?? 0;
  const prestigeMultiplier = options.prestigeMultiplier ?? 1;
  const cash = Math.floor(grid.maxPower * autoSellPercent / 100) * prestigeMultiplier;

  return Object.freeze({
    power: cellPower + stirlingPower,
    cellPower,
    stirlingPower,
    heatGeneration,
    vent,
    inlet,
    outlet,
    totalPartHeat,
    netHeat: heatGeneration - vent - outlet,
    cash,
    maxPower: grid.maxPower,
    maxHeat: grid.maxHeat,
  });
}

export function createReactorStatsComputer(options = {}) {
  return {
    compute({ grid, modifiers, upgrades, economy, mechanicsOverrides }) {
      return deriveReactorStats(grid, modifiers || {}, {
        autoSellPercent: upgrades?.getAutoSellPercent?.() ?? 0,
        prestigeMultiplier: economy?.getPrestigeMultiplier?.() ?? options.prestigeMultiplier ?? 1,
        mechanicsOverrides,
      });
    },
  };
}

import { isBroken } from '../reactor/createInstance.js';
import { computeNeighborPulseN, computeCellOutput, resolveCellCoefficients } from '../reactor/phases/cellPhase.js';
import { CARDINAL_OFFSETS } from '../kernel/gridUtils.js';

const HEAT_POWER_LOG_BASE = 1000;
const HEAT_POWER_LOG_CAP = 1e100;
const HEAT_POWER_PERCENT_DIVISOR = 100;
const HEAT_EPSILON = 0.001;

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

function manualVentReduction(grid, modifiers = {}, options = {}) {
  const baseReduce = (options.baseManualHeatReduce ?? 1) * (modifiers.manualVentMultiplier || 1);
  const percent = modifiers.manualVentPercent || 0;
  return baseReduce + (grid.maxHeat || 0) * percent;
}

function resolveAutoSellFraction(modifiers = {}, options = {}) {
  if (options.autoSellActive === false) return 0;
  if (options.autoSellActive !== true && !options.toggles?.auto_sell) return 0;
  const percent = options.autoSellPercent ?? modifiers.autoSellPercent ?? 0;
  return Math.max(0, Math.min(1, percent / 100));
}

export function deriveReactorStats(grid, modifiers = {}, options = {}) {
  const overrides = options.mechanicsOverrides || {};
  const reflectorCooling = overrides.reflectorCoolingFactor ?? modifiers.reflectorCoolingFactor ?? 0;
  const stirlingMult = overrides.stirlingMultiplier ?? modifiers.stirlingMultiplier ?? 0;
  const heatPowerMult = overrides.heatPowerMultiplier ?? modifiers.heatPowerMultiplier ?? 0;
  const heatBoost = heatPowerMultiplier(heatPowerMult, grid.currentHeat || 0);
  const protiumParticles = options.protiumParticles ?? 0;
  const coeffOptions = { modifiers, protiumParticles };

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
      const { layoutPower, generatedHeat } = computeCellOutput(
        def, inst, pulse, reflectors, reflectorCooling, 1, coeffOptions,
      );
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
  const power = cellPower + stirlingPower;
  const autoSellPercent = options.autoSellPercent ?? modifiers.autoSellPercent ?? 0;
  const prestigeMultiplier = options.prestigeMultiplier ?? 1;
  const cash = Math.floor(grid.maxPower * autoSellPercent / 100) * prestigeMultiplier;
  const netHeat = heatGeneration - vent - outlet;

  const sellFraction = resolveAutoSellFraction(modifiers, options);
  const powerNetChange = power * (1 - sellFraction);

  const overflowRatio = overrides.powerToHeatRatio
    ?? modifiers.powerToHeatRatio
    ?? options.powerOverflowToHeatRatio
    ?? 0;
  const overflowHeat = Math.max(0, (grid.currentPower || 0) + power - (grid.maxPower || 0)) * overflowRatio;
  const manualReduce = options.includeManualVent === false
    ? 0
    : manualVentReduction(grid, modifiers, options);
  const heatNetChange = netHeat + overflowHeat - manualReduce;

  const maxHeat = grid.maxHeat || 0;
  const heatRatio = maxHeat > 0 ? (grid.currentHeat || 0) / maxHeat : 0;
  const criticalHeatRatio = options.criticalHeatRatio ?? 0.85;
  const highHeatRatio = options.highHeatRatio ?? Math.min(criticalHeatRatio, 0.7);
  let heatWarningLevel = null;
  if (heatRatio >= criticalHeatRatio) heatWarningLevel = 'critical';
  else if (heatRatio >= highHeatRatio) heatWarningLevel = 'high';

  return Object.freeze({
    power,
    cellPower,
    stirlingPower,
    heatGeneration,
    vent,
    inlet,
    outlet,
    totalPartHeat,
    netHeat,
    powerNetChange,
    heatNetChange,
    heatRatio,
    heatWarningLevel,
    cash,
    maxPower: grid.maxPower,
    maxHeat: grid.maxHeat,
  });
}

export function createReactorStatsComputer(options = {}) {
  const manifest = options.manifest || (options.mechanics || options.gridDefaults ? options : null);
  const criticalHeatRatio = manifest?.mechanics?.criticalHeatRatio
    ?? options.criticalHeatRatio
    ?? 0.85;
  const highHeatRatio = manifest?.mechanics?.highHeatRatio
    ?? options.highHeatRatio
    ?? 0.7;
  const baseManualHeatReduce = manifest?.mechanics?.baseManualHeatReduce
    ?? options.baseManualHeatReduce
    ?? 1;
  const powerOverflowToHeatRatio = manifest?.mechanics?.economy?.powerOverflowToHeatRatio
    ?? options.powerOverflowToHeatRatio
    ?? 1;

  return {
    compute({ grid, modifiers, upgrades, economy, mechanicsOverrides, toggles }) {
      return deriveReactorStats(grid, modifiers || {}, {
        autoSellPercent: upgrades?.getAutoSellPercent?.() ?? modifiers?.autoSellPercent ?? 0,
        prestigeMultiplier: economy?.getPrestigeMultiplier?.() ?? options.prestigeMultiplier ?? 1,
        mechanicsOverrides,
        toggles,
        autoSellActive: toggles?.auto_sell,
        protiumParticles: economy?.protiumParticles ?? 0,
        criticalHeatRatio,
        highHeatRatio,
        baseManualHeatReduce,
        powerOverflowToHeatRatio,
        includeManualVent: true,
      });
    },
  };
}

export { resolveCellCoefficients, manualVentReduction, HEAT_EPSILON };

import { isBroken } from '../reactor/createInstance.js';
import {
  computeNeighborPulseN,
  computeCellOutput,
  resolveCellCoefficients,
  countActiveReflectorNeighbors,
} from '../reactor/phases/cellPhase.js';
import {
  computeGridMultiplierBonuses,
  resolveTransferRate,
  resolveVentRate,
} from '../reactor/heat/effectiveRates.js';
import { heatPowerMultiplier } from './heatPower.js';

const HEAT_EPSILON = 0.001;

export { heatPowerMultiplier };

function manualVentReduction(grid, modifiers = {}, options = {}) {
  const baseReduce = (options.baseManualHeatReduce ?? 1) * (modifiers.manualVentMultiplier || 1);
  const percent = modifiers.manualVentPercent || 0;
  return baseReduce + (grid.maxHeat || 0) * percent;
}

function resolveAutoSellFraction(modifiers = {}, options = {}) {
  if (options.autoSellActive === false) return 0;
  const fromUpgrade = !!(options.mechanicsOverrides?.autoSellFromUpgrade || modifiers.autoSellFromUpgrade);
  if (options.autoSellActive !== true && !options.toggles?.auto_sell && !fromUpgrade) return 0;
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
  const coeffOptions = {
    modifiers,
    protiumParticles,
    honorHostEffective: overrides.honorHostEffective === true || options.honorHostEffective === true,
  };
  const bonuses = computeGridMultiplierBonuses(grid, modifiers);

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
      vent += resolveVentRate(inst, bonuses);
    } else if (def.category === 'heat_inlet') {
      inlet += resolveTransferRate(inst, bonuses);
    } else if (def.category === 'heat_outlet') {
      outlet += resolveTransferRate(inst, bonuses);
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
    transferMultiplier: bonuses.transferMultiplier,
    ventMultiplier: bonuses.ventMultiplier,
    transfer_multiplier_eff: bonuses.transferMultiplier,
    vent_multiplier_eff: bonuses.ventMultiplier,
    transferAdditivePercent: bonuses.transferAdditivePercent,
    ventAdditivePercent: bonuses.ventAdditivePercent,
    transfer_multiplier_add: bonuses.transferAdditivePercent,
    vent_multiplier_add: bonuses.ventAdditivePercent,
    platingLevels: bonuses.platingLevels,
    capacitorLevels: bonuses.capacitorLevels,
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
        autoSellPercent: mechanicsOverrides?.autoSellPercent
          ?? upgrades?.getAutoSellPercent?.()
          ?? modifiers?.autoSellPercent
          ?? 0,
        prestigeMultiplier: economy?.getPrestigeMultiplier?.() ?? options.prestigeMultiplier ?? 1,
        mechanicsOverrides,
        toggles,
        autoSellActive: toggles?.auto_sell || mechanicsOverrides?.autoSellFromUpgrade,
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

export { resolveCellCoefficients, countActiveReflectorNeighbors, manualVentReduction, HEAT_EPSILON, computeGridMultiplierBonuses };

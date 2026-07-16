import { isBroken } from '../createInstance.js';
import { CARDINAL_OFFSETS } from '../../kernel/gridUtils.js';
import { heatPowerMultiplier } from '../../systems/heatPower.js';

function reflectorPulseValue(def) {
  if (def.neighborPulseValue != null) return def.neighborPulseValue;
  return Math.max(0, 1 + (def.powerIncrease || 0) / 100);
}

export function computeNeighborPulseN(grid, row, col, offsets = CARDINAL_OFFSETS) {
  const inst = grid.getComponentAt(row, col);
  if (!inst || inst.definition.category !== 'cell') return 0;
  let n = 0;
  for (const [dr, dc] of offsets) {
    const neighbor = grid.getComponentAt(row + dr, col + dc);
    if (!neighbor || isBroken(neighbor) || neighbor.pendingDestruction) continue;
    const def = neighbor.definition;
    if (def.category === 'cell' && neighbor.ticks > 0) n += def.cellCount || 1;
    if (def.category === 'reflector' && neighbor.ticks > 0) n += reflectorPulseValue(def);
  }
  return n;
}

function countContainmentNeighbors(grid, row, col, offsets = CARDINAL_OFFSETS) {
  let count = 0;
  for (const [dr, dc] of offsets) {
    const neighbor = grid.getComponentAt(row + dr, col + dc);
    if (!neighbor || neighbor.pendingDestruction) continue;
    if ((neighbor.definition.containment || 0) > 0) count++;
  }
  return count;
}

function distributeHeatToNeighbors(grid, row, col, generatedHeat, validCount, offsets = CARDINAL_OFFSETS) {
  const perNeighbor = generatedHeat / validCount;
  for (const [dr, dc] of offsets) {
    const nr = row + dr;
    const nc = col + dc;
    const neighbor = grid.getComponentAt(nr, nc);
    if (!neighbor || neighbor.pendingDestruction) continue;
    if ((neighbor.definition.containment || 0) > 0) grid.addTileHeat(nr, nc, perNeighbor);
  }
}

function processReflectorNeighbors(grid, row, col, multiplier, offsets = CARDINAL_OFFSETS) {
  for (const [dr, dc] of offsets) {
    const reflector = grid.getComponentAt(row + dr, col + dc);
    if (!reflector || reflector.definition.category !== 'reflector') continue;
    if (reflector.ticks > 0) {
      reflector.ticks -= multiplier;
      reflector.currentDamage = (reflector.definition.baseTicks || reflector.definition.maxDamage) - reflector.ticks;
    }
  }
}

export function countActiveReflectorNeighbors(grid, row, col, offsets = CARDINAL_OFFSETS) {
  let count = 0;
  for (const [dr, dc] of offsets) {
    const neighbor = grid.getComponentAt(row + dr, col + dc);
    if (neighbor && !isBroken(neighbor) && neighbor.definition.category === 'reflector' && neighbor.ticks > 0) {
      count++;
    }
  }
  return count;
}

export function resolveCellCoefficients(def, options = {}) {
  let power = def.basePower ?? def.power ?? 0;
  let heat = def.baseHeat ?? def.heat ?? 0;
  const modifiers = options.modifiers || {};
  const powerMult = modifiers.powerMultiplier || 1;
  const heatMult = modifiers.heatMultiplier || 1;
  power *= powerMult;
  heat *= heatMult;

  const typeLevel = modifiers.cellPowerByType?.[def.type] || 0;
  if (typeLevel > 0) power *= Math.pow(2, typeLevel);

  if (def.type === 'protium') {
    const unstable = modifiers.unstableProtiumLevel || 0;
    if (unstable > 0) {
      power *= Math.pow(2, unstable);
      heat *= Math.pow(0.5, unstable);
    }
    const depleted = options.protiumParticles ?? 0;
    if (depleted > 0) heat *= (1 + 0.10 * depleted);
  }

  return { power, heat };
}

export function computeCellOutput(def, inst, pulse, reflectorCount, reflectorCooling, multiplier = 1, options = {}) {
  let heatMult = 1;
  if (reflectorCooling > 0 && reflectorCount > 0) {
    heatMult = Math.max(0.1, 1 - reflectorCount * reflectorCooling);
  }
  const c = Math.max(1, def.cellCount ?? 1);
  const layoutOverride = typeof inst?.power === 'number' && typeof inst?.heat === 'number'
    ? { power: inst.power, heat: inst.heat }
    : null;
  const honorHost = options.honorHostEffective === true;
  const hostEffective = honorHost
    && typeof inst?._effectivePower === 'number'
    && typeof inst?._effectiveHeat === 'number'
    ? { power: inst._effectivePower, heat: inst._effectiveHeat }
    : null;
  const override = layoutOverride || hostEffective;
  if (override) {
    return {
      layoutPower: override.power,
      generatedHeat: override.heat * multiplier,
      heatMult,
      pulse,
    };
  }

  const coeffs = options.coefficients || resolveCellCoefficients(def, options);
  const lp = coeffs.power;
  const hEff = coeffs.heat * heatMult;
  const layoutPower = lp * pulse;
  const generatedHeat = ((hEff * pulse * pulse) / c) * multiplier;
  return { layoutPower, generatedHeat, heatMult, pulse };
}

export function runCellPhase(ctx, policy = {}) {
  const { grid, active = true } = ctx;
  const multiplier = ctx.multiplier ?? 1;
  let powerAdd = 0;
  let heatAdd = 0;
  const modifiers = ctx.session?.modifiers || ctx.upgrades?.compileModifiers?.() || {};
  const overrides = ctx.session?.mechanicsOverrides || {};
  const reflectorCooling = policy.reflectorCooling?.(ctx)
    ?? overrides.reflectorCoolingFactor
    ?? modifiers.reflectorCoolingFactor
    ?? 0;
  const heatPowerMult = overrides.heatPowerMultiplier
    ?? modifiers.heatPowerMultiplier
    ?? 0;
  const heatBoost = heatPowerMultiplier(heatPowerMult, grid.currentHeat || 0);
  const protiumParticles = ctx.economy?.protiumParticles ?? ctx.session?.systems?.economy?.protiumParticles ?? 0;
  const cellOutputs = [];
  const coeffOptions = {
    modifiers,
    protiumParticles,
    honorHostEffective: policy.honorHostEffective === true
      || overrides.honorHostEffective === true,
  };

  grid.forEach((row, col, inst) => {
    if (!inst || inst.pendingDestruction || isBroken(inst)) return;
    const def = inst.definition;
    if (def.category !== 'cell' || inst.ticks <= 0) return;

    const reflectorCount = countActiveReflectorNeighbors(grid, row, col);
    const m = def.cellMultiplier ?? def.pulseMultiplier ?? 1;
    const n = computeNeighborPulseN(grid, row, col);
    const pulse = m + n;
    const { layoutPower, generatedHeat } = computeCellOutput(
      def, inst, pulse, reflectorCount, reflectorCooling, multiplier, coeffOptions,
    );
    const boostedPower = layoutPower * heatBoost;

    if (active) {
      powerAdd += boostedPower * multiplier;
      inst._powerGenerated = boostedPower * multiplier;
    }

    const validCount = countContainmentNeighbors(grid, row, col);
    if (validCount > 0) distributeHeatToNeighbors(grid, row, col, generatedHeat, validCount);
    else heatAdd += generatedHeat;

    inst._heatGenerated = generatedHeat;
    inst.ticks -= multiplier;
    inst.currentDamage = (def.maxDamage || Math.floor(def.baseTicks) || 0) - inst.ticks;
    processReflectorNeighbors(grid, row, col, multiplier);
    cellOutputs.push({
      row,
      col,
      power: boostedPower * (active ? multiplier : 1),
      heat: generatedHeat,
      pulseN: n,
      pulse,
      reflectorCount,
      heatBoost,
    });
    policy.onCellDepleted?.(ctx, { row, col, inst, def });
  });

  if (active && powerAdd > 0) grid.addPowerRaw(powerAdd);
  if (heatAdd > 0) grid.adjustCurrentHeat(heatAdd);

  ctx.result.heatOutput = (ctx.result.heatOutput || 0) + heatAdd;
  ctx.result.powerOutput = (ctx.result.powerOutput || 0) + powerAdd;
  ctx.result.cellOutputs = Object.freeze(cellOutputs.map((o) => Object.freeze({ ...o })));
  return { powerAdd, heatAdd, cellOutputs: ctx.result.cellOutputs };
}

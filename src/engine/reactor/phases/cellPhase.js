import { isBroken } from '../createInstance.js';
import { CARDINAL_OFFSETS } from '../../kernel/gridUtils.js';

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

function resolveCellPower(def, inst) {
  if (typeof inst._effectivePower === 'number') return inst._effectivePower;
  return def.basePower ?? def.power ?? 0;
}

function resolveCellHeat(def, inst) {
  if (typeof inst._effectiveHeat === 'number') return inst._effectiveHeat;
  return def.baseHeat ?? def.heat ?? 0;
}

export function computeCellOutput(def, inst, pulse, reflectorCount, reflectorCooling, multiplier = 1) {
  let heatMult = 1;
  if (reflectorCooling > 0 && reflectorCount > 0) {
    heatMult = Math.max(0.1, 1 - reflectorCount * reflectorCooling);
  }
  const c = Math.max(1, def.cellCount ?? 1);
  const lp = resolveCellPower(def, inst);
  const hEff = resolveCellHeat(def, inst) * heatMult;
  const layoutPower = typeof inst._effectivePower === 'number' ? inst._effectivePower : lp * pulse;
  const generatedHeat = typeof inst._effectiveHeat === 'number'
    ? inst._effectiveHeat * multiplier
    : ((hEff * pulse * pulse) / c) * multiplier;
  return { layoutPower, generatedHeat, heatMult };
}

export function runCellPhase(ctx, policy = {}) {
  const { grid, active = true } = ctx;
  const multiplier = ctx.multiplier ?? 1;
  let powerAdd = 0;
  let heatAdd = 0;
  const reflectorCooling = policy.reflectorCooling?.(ctx)
    ?? ctx.session?.mechanicsOverrides?.reflectorCoolingFactor
    ?? ctx.upgrades?.getModifier?.('reflector_cooling_factor')
    ?? 0;

  grid.forEach((row, col, inst) => {
    if (!inst || inst.pendingDestruction || isBroken(inst)) return;
    const def = inst.definition;
    if (def.category !== 'cell' || inst.ticks <= 0) return;

    let reflectorCount = 0;
    for (const [dr, dc] of CARDINAL_OFFSETS) {
      const neighbor = grid.getComponentAt(row + dr, col + dc);
      if (neighbor && !isBroken(neighbor) && neighbor.definition.category === 'reflector' && neighbor.ticks > 0) {
        reflectorCount++;
      }
    }

    const m = def.cellMultiplier ?? def.pulseMultiplier ?? 1;
    const n = computeNeighborPulseN(grid, row, col);
    const pulse = m + n;
    const { layoutPower, generatedHeat } = computeCellOutput(def, inst, pulse, reflectorCount, reflectorCooling, multiplier);

    if (active) {
      powerAdd += layoutPower * multiplier;
      inst._powerGenerated = layoutPower * multiplier;
    }

    const validCount = countContainmentNeighbors(grid, row, col);
    if (validCount > 0) distributeHeatToNeighbors(grid, row, col, generatedHeat, validCount);
    else heatAdd += generatedHeat;

    inst._heatGenerated = generatedHeat;
    inst.ticks -= multiplier;
    inst.currentDamage = (def.baseTicks || def.maxDamage) - inst.ticks;
    processReflectorNeighbors(grid, row, col, multiplier);
    policy.onCellDepleted?.(ctx, { row, col, inst, def });
  });

  if (active && powerAdd > 0) grid.addPowerRaw(powerAdd);
  if (heatAdd > 0) grid.adjustCurrentHeat(heatAdd);

  ctx.result.heatOutput = (ctx.result.heatOutput || 0) + heatAdd;
  ctx.result.powerOutput = (ctx.result.powerOutput || 0) + powerAdd;
  return { powerAdd, heatAdd };
}

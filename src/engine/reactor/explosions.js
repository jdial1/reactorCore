import { isBroken } from './createInstance.js';
import { resolveContainment } from './heat/effectiveRates.js';

function getIntegrity(grid, row, col) {
  if (grid.tileHeatMap) return grid.tileHeatMap.getIntegrity(row, col);
  return 100;
}

function setIntegrity(grid, row, col, value) {
  if (grid.tileHeatMap) grid.tileHeatMap.setIntegrity(row, col, value);
}

export function applyThermalStress(ctx) {
  const multiplier = ctx.multiplier ?? 1;
  let leakedHeat = 0;

  ctx.grid.forEach((row, col, inst) => {
    if (!inst) return;
    const cap = resolveContainment(inst);
    if (cap <= 0) return;
    const heat = ctx.grid.getTileHeat(row, col);
    const pressure = heat / cap;
    if (pressure <= 1) return;

    let integrity = getIntegrity(ctx.grid, row, col);
    integrity -= (pressure - 1) * multiplier;
    if (integrity < 0) integrity = 0;
    setIntegrity(ctx.grid, row, col, integrity);

    const leakage = (heat - cap) * (1 - integrity / 100) * multiplier;
    if (leakage > 0) {
      ctx.grid.setTileHeat(row, col, heat - leakage);
      ctx.grid.adjustCurrentHeat(leakage);
      leakedHeat += leakage;
    }
  });

  if (leakedHeat > 0) ctx.result.leakedHeat = (ctx.result.leakedHeat || 0) + leakedHeat;
  return leakedHeat;
}

function capSortPriority(def) {
  return def.category === 'capacitor' ? 0 : 1;
}

export function collectOverpressureExplosions(ctx) {
  const { grid } = ctx;
  const candidates = [];

  grid.forEach((row, col, inst) => {
    if (!inst || inst.pendingDestruction || isBroken(inst)) return;
    const activated = grid.tileHeatMap?.isActivated(row, col) ?? true;
    if (!activated) return;
    const cap = resolveContainment(inst);
    if (cap <= 0) return;
    const heat = grid.getTileHeat(row, col);
    const integrity = getIntegrity(grid, row, col);
    if (heat > cap || integrity <= 0) {
      candidates.push({ row, col, inst, priority: capSortPriority(inst.definition) });
    }
  });

  candidates.sort((a, b) => a.priority - b.priority);
  return candidates;
}

export function explodeComponent(ctx, row, col, inst) {
  if (ctx.grid.tileHeatMap) ctx.grid.tileHeatMap.setIntegrity(row, col, 0);
  ctx.result.destroyedComponents.push({
    row,
    col,
    id: inst.definition.id,
    name: inst.definition.displayName || inst.definition.name,
    reason: 'explosion',
  });
  ctx.session?.events?.emit('componentExplosion', { row, col, id: inst.definition.id });
}

export function processExplosions(ctx) {
  if (!ctx.features.containmentExplosions || ctx.session?.suppressExplosions) return [];
  const candidates = collectOverpressureExplosions(ctx);
  for (let i = 0; i < candidates.length; i++) {
    const { row, col, inst } = candidates[i];
    if (!inst.pendingDestruction) explodeComponent(ctx, row, col, inst);
  }
  if (candidates.length) ctx.result.explosionCount = (ctx.result.explosionCount || 0) + candidates.length;
  return candidates;
}

export function applyHullRepulsion(ctx) {
  const { grid, manifest } = ctx;
  const max = grid.maxHeat;
  const heat = grid.currentHeat;
  if (heat <= max) return 0;

  const fraction = manifest.mechanics?.failure?.hullRepelFraction
    ?? manifest.mechanics?.hullRepelFraction ?? 0.05;
  const excess = heat - max;
  const totalRepel = excess * fraction;

  const tiles = [];
  grid.forEach((row, col, inst) => {
    if (inst) tiles.push({ row, col });
  });
  if (tiles.length === 0) return 0;

  const perTile = totalRepel / tiles.length;
  grid.currentHeat -= totalRepel;
  for (let i = 0; i < tiles.length; i++) {
    const { row, col } = tiles[i];
    grid.addTileHeat(row, col, perTile);
  }
  ctx.result.repelledHeat = (ctx.result.repelledHeat || 0) + totalRepel;
  return totalRepel;
}

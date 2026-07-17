import { resolveEpHeat } from './epHeat.js';
import { buildBehavior } from '../reactor/behaviors/index.js';
import { isPartPerpetual } from './mechanicsPolicy.js';
import { heatPowerMultiplier } from './heatPower.js';
import { resolveCellCoefficients } from '../reactor/phases/cellPhase.js';

function pickManifestPart(manifest, id) {
  return (manifest?.components || []).find((c) => c.id === id) || null;
}

function catalogOptions(session) {
  if (!session) return {};
  return {
    modifiers: session.modifiers,
    exoticParticles: session.systems?.economy?.currentExoticParticles,
    weaveQuantum: session.systems?.economy?.weaveQuantum
      ?? session.manifest?.economy?.weaveQuantum,
    currentHeat: session.grid?.currentHeat,
    heatPowerMultiplier: session.mechanicsOverrides?.heatPowerMultiplier
      ?? session.modifiers?.heatPowerMultiplier
      ?? 0,
    protiumParticles: session.systems?.economy?.protiumParticles ?? 0,
  };
}

function resolveCatalogEpHeat(def, src, options = {}) {
  const category = def.category || src.category;
  if (category !== 'particle_accelerator') {
    return def.epHeat ?? src.epHeat ?? 0;
  }
  const base = def.baseEpHeat ?? src.baseEpHeat ?? src.epHeat ?? def.epHeat ?? 0;
  return resolveEpHeat(base, {
    partLevel: def.level ?? src.level ?? 1,
    acceleratorEpHeatByLevel: options.modifiers?.acceleratorEpHeatByLevel,
    catalystReduction: options.modifiers?.catalystReduction || 0,
    exoticParticles: options.exoticParticles,
    weaveQuantum: options.weaveQuantum,
  });
}

function resolveShopPowerHeat(def, src, options = {}) {
  const category = def.category || src.category;
  const modifiers = options.modifiers || {};
  const hpm = options.heatPowerMultiplier ?? modifiers.heatPowerMultiplier ?? 0;
  const heatBoost = heatPowerMultiplier(hpm, options.currentHeat || 0);
  if (category === 'cell') {
    const coeffs = resolveCellCoefficients(def, {
      modifiers,
      protiumParticles: options.protiumParticles ?? 0,
    });
    const M = def.cellMultiplier ?? src.cellMultiplier ?? 1;
    const C = Math.max(1, def.cellCount ?? src.cellCount ?? 1);
    return {
      power: coeffs.power * M * heatBoost,
      heat: (coeffs.heat * M * M) / C,
      heatBoost,
    };
  }
  const basePower = def.basePower ?? src.basePower ?? 0;
  const baseHeat = def.baseHeat ?? src.baseHeat ?? 0;
  return {
    power: basePower * heatBoost,
    heat: baseHeat,
    heatBoost,
  };
}

export function projectCompiledPart(def, raw = null, options = {}) {
  if (!def) return null;
  const src = raw || {};
  const baseEpHeat = def.baseEpHeat ?? src.baseEpHeat ?? src.epHeat ?? null;
  const perpetual = !!def.perpetual
    || isPartPerpetual(def, options.modifiers || {})
    || isPartPerpetual(src, options.modifiers || {});
  const shop = resolveShopPowerHeat(def, src, options);
  return {
    id: def.id,
    title: def.title || def.displayName || src.title || def.id,
    category: def.category || src.category || null,
    type: def.type || src.type || null,
    level: def.level ?? src.level ?? 1,
    icon: src.icon || def.icon || null,
    experimental: !!(src.experimental ?? def.experimental),
    erequires: src.erequires ?? def.erequires ?? null,
    baseCost: def.baseCost ?? src.baseCost ?? 0,
    baseTicks: def.baseTicks ?? src.baseTicks ?? 0,
    maxDamage: def.maxDamage ?? null,
    basePower: def.basePower ?? src.basePower ?? 0,
    baseHeat: def.baseHeat ?? src.baseHeat ?? 0,
    power: shop.power,
    heat: shop.heat,
    heatBoost: shop.heatBoost,
    containment: def.containment ?? src.containment ?? 0,
    reactorPower: def.reactorPower ?? def.powerAdjustment ?? src.reactorPower ?? 0,
    reactorHeat: def.reactorHeat ?? def.heatAdjustment ?? src.reactorHeat ?? 0,
    vent: def.vent ?? src.vent ?? 0,
    transfer: (typeof def.transferRate === 'number' ? def.transferRate : null)
      ?? (typeof def.transfer === 'number' ? def.transfer : null)
      ?? src.transfer ?? src.baseTransfer ?? 0,
    transferMultiplier: def.transferMultiplier
      ?? (Number(src.transfer_multiplier) > 0 ? Number(src.transfer_multiplier) : null)
      ?? null,
    powerIncrease: def.powerIncrease ?? src.powerIncrease ?? 0,
    heatIncrease: def.heatIncrease ?? src.heatIncrease ?? 0,
    neighborPulseValue: def.neighborPulseValue
      ?? ((def.category || src.category) === 'reflector'
        ? Math.max(0, 1 + ((def.powerIncrease ?? src.powerIncrease ?? 0) || 0) / 100)
        : null),
    maxHeat: def.maxHeat ?? null,
    cellCount: def.cellCount ?? src.cellCount ?? null,
    cellMultiplier: def.cellMultiplier ?? src.cellMultiplier ?? null,
    perpetual,
    baseDescription: src.baseDescription ?? src.base_description ?? def.baseDescription ?? null,
    baseEpHeat,
    epHeat: resolveCatalogEpHeat(def, src, options),
    definition: def,
  };
}

export function listCompiledParts(session) {
  const registry = session?.registry;
  if (!registry?.getAll) return [];
  const byId = new Map((session.manifest?.components || []).map((c) => [c.id, c]));
  const options = catalogOptions(session);
  return registry.getAll().map((def) => projectCompiledPart(def, byId.get(def.id), options));
}

export function getCompiledPart(session, id) {
  if (!session?.registry || id == null) return null;
  const def = session.registry.get(id);
  if (!def) return null;
  return projectCompiledPart(def, pickManifestPart(session.manifest, id), catalogOptions(session));
}

export function compilePartStats(partId, options = {}) {
  if (partId == null) return null;
  const {
    manifest,
    registry,
    modifiers = {},
    exoticParticles,
    weaveQuantum,
    currentHeat,
    heatPowerMultiplier: hpm,
    protiumParticles,
  } = options;
  const raw = pickManifestPart(manifest, partId);
  let def = null;
  if (raw) {
    def = buildBehavior(raw, modifiers);
  } else if (registry?.get) {
    def = registry.get(partId);
  }
  if (!def) return null;
  return projectCompiledPart(def, raw, {
    modifiers,
    exoticParticles,
    weaveQuantum,
    currentHeat,
    heatPowerMultiplier: hpm ?? modifiers.heatPowerMultiplier ?? 0,
    protiumParticles,
  });
}

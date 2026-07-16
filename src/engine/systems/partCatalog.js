import { resolveEpHeat } from './epHeat.js';

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

export function projectCompiledPart(def, raw = null, options = {}) {
  if (!def) return null;
  const src = raw || {};
  const baseEpHeat = def.baseEpHeat ?? src.baseEpHeat ?? src.epHeat ?? null;
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
    containment: def.containment ?? src.containment ?? 0,
    reactorPower: def.reactorPower ?? def.powerAdjustment ?? src.reactorPower ?? 0,
    reactorHeat: def.reactorHeat ?? def.heatAdjustment ?? src.reactorHeat ?? 0,
    vent: def.vent ?? src.vent ?? 0,
    transfer: (typeof def.transferRate === 'number' ? def.transferRate : null)
      ?? (typeof def.transfer === 'number' ? def.transfer : null)
      ?? src.transfer ?? src.baseTransfer ?? 0,
    powerIncrease: def.powerIncrease ?? src.powerIncrease ?? 0,
    heatIncrease: def.heatIncrease ?? src.heatIncrease ?? 0,
    maxHeat: def.maxHeat ?? null,
    cellCount: def.cellCount ?? src.cellCount ?? null,
    cellMultiplier: def.cellMultiplier ?? src.cellMultiplier ?? null,
    perpetual: !!def.perpetual,
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

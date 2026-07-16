function pickManifestPart(manifest, id) {
  return (manifest?.components || []).find((c) => c.id === id) || null;
}

export function projectCompiledPart(def, raw = null) {
  if (!def) return null;
  const src = raw || {};
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
    definition: def,
  };
}

export function listCompiledParts(session) {
  const registry = session?.registry;
  if (!registry?.getAll) return [];
  const byId = new Map((session.manifest?.components || []).map((c) => [c.id, c]));
  return registry.getAll().map((def) => projectCompiledPart(def, byId.get(def.id)));
}

export function getCompiledPart(session, id) {
  if (!session?.registry || id == null) return null;
  const def = session.registry.get(id);
  if (!def) return null;
  return projectCompiledPart(def, pickManifestPart(session.manifest, id));
}

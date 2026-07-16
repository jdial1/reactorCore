export function buildAutoReplaceCosts(components = []) {
  const costs = {};
  for (const part of components) {
    if (!part?.id) continue;
    const base = part.baseCost || 0;
    const cat = part.category;
    const mult = (cat === 'cell' || cat === 'reflector' || cat === 'capacitor') ? 1.5 : 1;
    costs[part.id] = base * mult;
  }
  return costs;
}

export function compileMechanicsOverrides(manifest, mods = {}, extras = {}) {
  const perpetualPartIds = new Set(Object.keys(mods.perpetualPartIds || {}));
  return {
    perpetualCategories: { ...(mods.perpetualCategories || {}) },
    perpetualPartIds,
    reflectorCoolingFactor: mods.reflectorCoolingFactor || 0,
    stirlingMultiplier: mods.stirlingMultiplier || 0,
    convectiveBoost: mods.convectiveBoost || 0,
    heatPowerMultiplier: mods.heatPowerMultiplier || 0,
    powerToHeatRatio: mods.powerToHeatRatio || 0,
    manualVentMultiplier: mods.manualVentMultiplier || 1,
    manualVentPercent: mods.manualVentPercent || 0,
    autoSellFromUpgrade: !!mods.autoSellFromUpgrade,
    autoBuyFromUpgrade: !!mods.autoBuyFromUpgrade,
    heatControlled: !!mods.heatControlled,
    heatOutletControlled: !!mods.heatOutletControlled,
    hasProtiumLoader: !!mods.hasProtiumLoader,
    sellPriceMultiplier: mods.sellPriceMultiplier || 1,
    autoSellPercent: mods.autoSellPercent || 0,
    powerOverflowToHeatRatio: manifest?.mechanics?.economy?.powerOverflowToHeatRatio
      ?? mods.powerOverflowToHeatRatio
      ?? 1,
    autoReplaceCosts: buildAutoReplaceCosts(manifest?.components),
    alteredMaxPower: extras.alteredMaxPower ?? mods.alteredMaxPower ?? 0,
  };
}

export const CORE_MECHANICS_OVERRIDE_KEYS = new Set([
  'perpetualCategories',
  'perpetualPartIds',
  'reflectorCoolingFactor',
  'stirlingMultiplier',
  'convectiveBoost',
  'heatPowerMultiplier',
  'powerToHeatRatio',
  'manualVentMultiplier',
  'manualVentPercent',
  'autoSellFromUpgrade',
  'autoBuyFromUpgrade',
  'heatControlled',
  'heatOutletControlled',
  'hasProtiumLoader',
  'sellPriceMultiplier',
  'autoSellPercent',
  'powerOverflowToHeatRatio',
  'autoReplaceCosts',
  'alteredMaxPower',
]);

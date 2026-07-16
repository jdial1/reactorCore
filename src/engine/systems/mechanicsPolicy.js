export const PERPETUAL_AUTO_REPLACE_MULTIPLIER = 1.5;
export const CAPACITOR_AUTO_REPLACE_MULTIPLIER = 10;

export function isPartPerpetual(part, mods = {}) {
  if (!part) return false;
  if (part.perpetual) return true;
  const ids = mods.perpetualPartIds;
  if (part.id != null && (ids?.has?.(part.id) || ids?.[part.id])) return true;
  const cat = part.category;
  if (cat && mods.perpetualCategories?.[cat]) return true;
  return false;
}

export function partAutoReplaceCost(part, mods = {}, options = {}) {
  const base = part?.baseCost || 0;
  if (!part) return 0;
  if (!isPartPerpetual(part, mods)) return base;
  const cat = part.category;
  if (cat === 'capacitor') {
    return base * (
      part.capacitorSellMultiplier
      ?? options.capacitorSellMultiplier
      ?? mods.capacitorSellMultiplier
      ?? CAPACITOR_AUTO_REPLACE_MULTIPLIER
    );
  }
  if (cat === 'cell' || cat === 'reflector') {
    return base * PERPETUAL_AUTO_REPLACE_MULTIPLIER;
  }
  return base;
}

export function buildAutoReplaceCosts(components = [], mods = {}, options = {}) {
  const costs = {};
  for (const part of components) {
    if (!part?.id) continue;
    costs[part.id] = partAutoReplaceCost(part, mods, options);
  }
  return costs;
}

export function compileMechanicsOverrides(manifest, mods = {}, extras = {}) {
  const perpetualPartIds = new Set(Object.keys(mods.perpetualPartIds || {}));
  const capacitorSellMultiplier = manifest?.mechanics?.autoReplace?.capacitorSellMultiplier
    ?? mods.capacitorSellMultiplier
    ?? CAPACITOR_AUTO_REPLACE_MULTIPLIER;
  return {
    perpetualCategories: { ...(mods.perpetualCategories || {}) },
    perpetualPartIds,
    capacitorSellMultiplier,
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
    autoReplaceCosts: buildAutoReplaceCosts(manifest?.components, {
      ...mods,
      perpetualPartIds: Object.fromEntries([...perpetualPartIds].map((id) => [id, true])),
      capacitorSellMultiplier,
    }),
    alteredMaxPower: extras.alteredMaxPower ?? mods.alteredMaxPower ?? 0,
  };
}

export const CORE_MECHANICS_OVERRIDE_KEYS = new Set([
  'perpetualCategories',
  'perpetualPartIds',
  'capacitorSellMultiplier',
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

function camelToSnake(key) {
  return String(key).replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

function projectValue(value) {
  if (value instanceof Set) return [...value];
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value !== 'function') {
    const nested = {};
    for (const [k, v] of Object.entries(value)) {
      nested[k] = v;
      nested[camelToSnake(k)] = v;
    }
    return nested;
  }
  return value;
}

export const MODIFIER_HOST_ALIASES = Object.freeze({
  ventEffectiveness: 'vent_effectiveness',
  transferEffectiveness: 'transfer_effectiveness',
  heatPowerMultiplier: 'heat_power_multiplier',
  autoSellPercent: 'auto_sell_percent',
  tickRateBonus: 'tick_rate_bonus',
  reflectorCoolingFactor: 'reflector_cooling_factor',
  stirlingMultiplier: 'stirling_multiplier',
  convectiveBoost: 'convective_boost',
  transferPlatingMultiplier: 'transfer_plating_multiplier',
  transferCapacitorMultiplier: 'transfer_capacitor_multiplier',
  ventPlatingMultiplier: 'vent_plating_multiplier',
  ventCapacitorMultiplier: 'vent_capacitor_multiplier',
  manualVentMultiplier: 'manual_vent_multiplier',
  manualVentPercent: 'manual_vent_percent',
  powerToHeatRatio: 'power_to_heat_ratio',
  perpetualCategories: 'perpetual_categories',
  perpetualPartIds: 'perpetual_part_ids',
  cellPowerByType: 'cell_power_by_type',
  cellTicksByType: 'cell_ticks_by_type',
  experimentalUnlocked: 'experimental_unlocked',
  hasProtiumLoader: 'has_protium_loader',
  sellPriceMultiplier: 'sell_price_multiplier',
});

export function projectModifiersForHost(modifiers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(modifiers || {})) {
    if (typeof value === 'function') continue;
    const projected = projectValue(value);
    out[key] = projected;
    out[camelToSnake(key)] = projected;
    const alias = MODIFIER_HOST_ALIASES[key];
    if (alias) out[alias] = projected;
  }
  return out;
}

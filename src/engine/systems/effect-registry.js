export function createBaseModifiers() {
  return {
    powerMultiplier: 1,
    heatMultiplier: 1,
    ventEffectiveness: 1,
    ventCapacity: 1,
    transferEffectiveness: 1,
    powerCapacity: 1,
    heatCapacity: 1,
    coolantCapacity: 1,
    platingCapacity: 1,
    tickRateBonus: 0,
    fissionBonus: null,
    autoSellPercent: 0,
    gridRowsBonus: 0,
    gridColsBonus: 0,
    reflectorDurationMultiplier: 1,
    reflectorPowerMultiplier: 1,
    manualVentMultiplier: 1,
    manualVentPercent: 0,
    heatPowerMultiplier: 0,
    heatControlled: false,
    heatOutletControlled: false,
    transferPlatingMultiplier: 0,
    transferCapacitorMultiplier: 0,
    ventPlatingMultiplier: 0,
    stirlingMultiplier: 0,
    convectiveBoost: 0,
    manualOverrideMult: 0,
    powerToHeatRatio: 0,
    catalystReduction: 0,
    thermalFeedbackRate: 0,
    volatileTuningMax: 0,
    platingHeatBonus: 0,
    reflectorCoolingFactor: 0,
    autoSellFromUpgrade: false,
    autoBuyFromUpgrade: false,
    experimentalUnlocked: false,
    perpetualCategories: {},
  };
}

export const EFFECT_HANDLERS = {
  power_multiplier(mods, def, level) {
    mods.powerMultiplier *= Math.pow(def.value || 2, level);
  },
  heat_multiplier(mods, def, level) {
    mods.heatMultiplier *= Math.pow(def.value || 2, level);
  },
  vent_effectiveness(mods, def, level) {
    mods.ventEffectiveness *= 1 + (def.value || 0.01) * level;
  },
  vent_capacity(mods, def, level) {
    mods.ventCapacity *= 1 + (def.value || 0.01) * level;
  },
  transfer_effectiveness(mods, def, level) {
    mods.transferEffectiveness *= 1 + (def.value || 0.01) * level;
  },
  coolant_capacity(mods, def, level) {
    mods.coolantCapacity *= Math.pow(def.value || 2, level);
  },
  plating_capacity(mods, def, level) {
    mods.platingCapacity *= Math.pow(def.value || 2, level);
  },
  tick_rate(mods, def, level) {
    mods.tickRateBonus += (def.value || 1) * level;
  },
  forceful_fission(mods, def, level) {
    mods.heatPowerMultiplier = level;
    mods.fissionBonus = (heat) => {
      let bonus = 1;
      for (let i = 0; i < level; i++) {
        const threshold = Math.pow(1000, i + 1);
        if (heat >= threshold) bonus += (i + 1) * 0.01;
      }
      return bonus;
    };
  },
  auto_sell_percent(mods, def, level) {
    mods.autoSellPercent += (def.value || 1) * level;
  },
  grid_rows(mods, def, level) {
    mods.gridRowsBonus += (def.value || 1) * level;
  },
  grid_cols(mods, def, level) {
    mods.gridColsBonus += (def.value || 1) * level;
  },
  reflector_duration(mods, def, level) {
    mods.reflectorDurationMultiplier *= Math.pow(def.value || 2, level);
  },
  reflector_power(mods, def, level) {
    mods.reflectorPowerMultiplier *= Math.pow(def.value || 2, level);
  },
  perpetual_category(mods, def, level) {
    if (level > 0 && def.category) mods.perpetualCategories[def.category] = true;
  },
  manual_vent_multiplier(mods, def, level) {
    if (level > 0) mods.manualVentMultiplier = def.value || 10;
  },
  heat_control(mods, def, level) {
    mods.heatControlled = level > 0;
  },
  heat_outlet_control(mods, def, level) {
    mods.heatOutletControlled = level > 0;
  },
  transfer_plating(mods, def, level) {
    mods.transferPlatingMultiplier = (def.value || 1) * level;
  },
  transfer_capacitor(mods, def, level) {
    mods.transferCapacitorMultiplier = (def.value || 1) * level;
  },
  vent_plating(mods, def, level) {
    mods.ventPlatingMultiplier = (def.value || 1) * level;
  },
  stirling_multiplier(mods, def, level) {
    mods.stirlingMultiplier = (def.value ?? 0.01) * level;
  },
  emergency_coolant(mods, def, level) {
    mods.manualVentPercent = Math.min(level, 3) * (def.value ?? 0.005);
  },
  manual_override(mods, def, level) {
    mods.manualOverrideMult = (def.value ?? 0.1) * level;
  },
  convective_boost(mods, def, level) {
    mods.convectiveBoost = (def.value ?? 0.1) * level;
  },
  electro_thermal(mods, def, level) {
    mods.powerToHeatRatio = level < 1 ? 0 : 2 + (level - 1) * 0.5;
  },
  catalyst_reduction(mods, def, level) {
    mods.catalystReduction = (def.value ?? 0.05) * level;
  },
  thermal_feedback(mods, def, level) {
    mods.thermalFeedbackRate = (def.value ?? 0.1) * level;
  },
  volatile_tuning(mods, def, level) {
    mods.volatileTuningMax = (def.value ?? 0.05) * level;
  },
  plating_heat_bonus(mods, def, level) {
    mods.platingHeatBonus = (def.value ?? 0.05) * level;
  },
  reflector_cooling(mods, def, level) {
    mods.reflectorCoolingFactor = (def.value ?? 0.02) * level;
  },
  auto_sell_toggle(mods, def, level) {
    mods.autoSellFromUpgrade = level > 0;
  },
  auto_buy_toggle(mods, def, level) {
    mods.autoBuyFromUpgrade = level > 0;
  },
  unlock_experimental(mods, def, level) {
    mods.experimentalUnlocked = level > 0;
  },
};

export function createEffectRegistry(customHandlers = {}) {
  return { ...EFFECT_HANDLERS, ...customHandlers };
}

export function compileModifiersFromEntries(entries, registry = EFFECT_HANDLERS) {
  const mods = createBaseModifiers();
  for (const { def, level } of entries) {
    if (!def || level <= 0) continue;
    const handler = registry[def.effect];
    if (handler) handler(mods, def, level);
  }
  return Object.freeze(mods);
}

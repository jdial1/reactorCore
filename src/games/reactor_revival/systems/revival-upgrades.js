import { createUpgradeStore } from '../../../engine/systems/upgrades.js';

const REVIVAL_EFFECTS = {
  chronometer: { effect: 'tick_rate', value: 1 },
  forceful_fusion: { effect: 'forceful_fission' },
  heat_control_operator: { effect: 'heat_control' },
  heat_outlet_control_operator: { effect: 'heat_outlet_control' },
  improved_piping: { effect: 'manual_vent_multiplier', value: 10 },
  perpetual_capacitors: { effect: 'perpetual_category', category: 'capacitor' },
  perpetual_reflectors: { effect: 'perpetual_category', category: 'reflector' },
  improved_coolant_cells: { effect: 'coolant_capacity', value: 2 },
  improved_reflector_density: { effect: 'reflector_duration', value: 2 },
  improved_neutron_reflection: { effect: 'reflector_power', value: 2 },
  improved_heat_exchangers: { effect: 'transfer_effectiveness', value: 0.01 },
  reinforced_heat_exchangers: { effect: 'transfer_plating', value: 1 },
  active_exchangers: { effect: 'transfer_capacitor', value: 1 },
  improved_heat_vents: { effect: 'vent_effectiveness', value: 0.01 },
  improved_heatsinks: { effect: 'vent_plating', value: 1 },
  active_venting: { effect: 'vent_capacity', value: 0.01 },
  improved_power_lines: { effect: 'auto_sell_percent', value: 1 },
  auto_sell_operator: { effect: 'auto_sell_toggle' },
  auto_buy_operator: { effect: 'auto_buy_toggle' },
  stirling_generators: { effect: 'stirling_multiplier', value: 0.01 },
  emergency_coolant: { effect: 'emergency_coolant', value: 0.005 },
  reflector_cooling: { effect: 'reflector_cooling', value: 0.02 },
  manual_override: { effect: 'manual_override', value: 0.1 },
  convective_airflow: { effect: 'convective_boost', value: 0.1 },
  electro_thermal_conversion: { effect: 'electro_thermal' },
  sub_atomic_catalysts: { effect: 'catalyst_reduction', value: 0.05 },
  thermal_feedback: { effect: 'thermal_feedback', value: 0.1 },
  volatile_tuning: { effect: 'volatile_tuning', value: 0.05 },
  ceramic_composite: { effect: 'plating_heat_bonus', value: 0.05 },
  expand_reactor_rows: { effect: 'grid_rows', value: 1 },
  expand_reactor_cols: { effect: 'grid_cols', value: 1 },
  laboratory: { effect: 'unlock_experimental' },
  infused_cells: { effect: 'power_multiplier', value: 2 },
  unleashed_cells: { effect: 'heat_multiplier', value: 2 },
};

export function createRevivalUpgradeStore(manifest) {
  const flatUpgrades = (manifest.upgrades || []).map((u) => {
    const mapped = REVIVAL_EFFECTS[u.actionId] || REVIVAL_EFFECTS[u.id] || {};
    return {
      id: u.id,
      title: u.title,
      baseCost: u.ecost != null ? u.ecost : u.cost,
      costMultiplier: u.multiplier ?? 2,
      maxLevel: u.levels ?? null,
      currency: u.ecost != null ? 'ep' : 'money',
      erequires: u.erequires ? [u.erequires] : undefined,
      effect: mapped.effect || u.actionId || 'custom',
      value: mapped.value ?? 1,
      category: mapped.category,
      type: u.type,
    };
  });

  return createUpgradeStore({ ...manifest, upgrades: flatUpgrades });
}

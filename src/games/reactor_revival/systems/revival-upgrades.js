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
  improved_neutron_reflection: { effect: 'reflector_power', value: 0.01 },
  improved_heat_exchangers: { effect: 'transfer_boost', value: 1 },
  reinforced_heat_exchangers: { effect: 'transfer_plating', value: 1 },
  active_exchangers: { effect: 'transfer_capacitor', value: 1 },
  improved_heat_vents: { effect: 'vent_boost', value: 1 },
  improved_heatsinks: { effect: 'vent_plating', value: 1 },
  active_venting: { effect: 'vent_capacitor', value: 1 },
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
  unstable_protium: { effect: 'unstable_protium' },
  isotope_stabilization: { effect: 'cell_ticks_global', value: 0.05 },
  component_reinforcement: { effect: 'component_reinforcement', value: 0.1 },
  experimental_protium_loader: { effect: 'protium_loader' },
  full_spectrum_reflectors: { effect: 'reflector_power_bonus', value: 1 },
  fluid_hyperdynamics: { effect: 'fluid_hyperdynamics', value: 2 },
  fractal_piping: { effect: 'fractal_piping', value: 2 },
  ultracryonics: { effect: 'coolant_capacity', value: 2 },
};

const CELL_TYPES = new Set([
  'cell', 'uranium', 'plutonium', 'thorium', 'seaborgium', 'dolorium', 'nefastium', 'protium',
]);

function isLevelOneCell(part) {
  if ((part.level ?? 1) !== 1) return false;
  return CELL_TYPES.has(part.type) || part.category === 'cell';
}

function buildCellPowerUpgrades(components) {
  const out = [];
  for (const part of components || []) {
    if (!isLevelOneCell(part) || part.cellPowerUpgradeCost == null) continue;
    const cellType = part.type || 'cell';
    out.push({
      id: `${part.id}_cell_power`,
      title: `Potent ${part.title || part.id}`,
      baseCost: part.cellPowerUpgradeCost,
      costMultiplier: part.cellPowerUpgradeMultiplier ?? part.costMultiplier ?? 10,
      maxLevel: null,
      currency: 'money',
      effect: 'cell_power',
      cellType,
      partId: part.id,
      value: 2,
      type: 'cell_power',
      icon: part.icon || null,
      section: 'cell_power',
    });
  }
  return out;
}

function buildCellTickUpgrades(components) {
  const out = [];
  for (const part of components || []) {
    if (!isLevelOneCell(part) || part.cellTickUpgradeCost == null) continue;
    const cellType = part.type || 'cell';
    out.push({
      id: `${part.id}_cell_tick`,
      title: `Enriched ${part.title || part.id}`,
      baseCost: part.cellTickUpgradeCost,
      costMultiplier: part.cellTickUpgradeMultiplier ?? part.costMultiplier ?? 10,
      maxLevel: null,
      currency: 'money',
      effect: 'cell_tick',
      cellType,
      partId: part.id,
      value: 2,
      type: 'cell_tick',
      icon: part.icon || null,
      section: 'cell_tick',
    });
  }
  return out;
}

function buildCellPerpetualUpgrades(components) {
  const out = [];
  for (const part of components || []) {
    if (!isLevelOneCell(part) || part.cellPerpetualUpgradeCost == null) continue;
    out.push({
      id: `${part.id}_cell_perpetual`,
      title: `Perpetual ${part.title || part.id}`,
      baseCost: part.cellPerpetualUpgradeCost,
      costMultiplier: part.cellPerpetualUpgradeMultiplier ?? 1,
      maxLevel: 1,
      currency: 'money',
      effect: 'cell_perpetual',
      cellType: part.type || 'cell',
      partId: part.id,
      value: 1,
      type: 'cell_perpetual',
      icon: part.icon || null,
      section: 'cell_perpetual',
    });
  }
  return out;
}

export function createTechTreePurchaseGate(manifest) {
  const trees = manifest.techTree || [];
  const byId = new Map(trees.map((t) => [t.id, new Set(t.upgrades || [])]));
  const listedAnywhere = new Set();
  for (const set of byId.values()) for (const id of set) listedAnywhere.add(id);

  return (session, id, def) => {
    const treeId = session?.techTree || 'unified';
    if (treeId === 'unified') return true;
    const allowed = byId.get(treeId);
    if (!allowed || allowed.size === 0) return true;
    if (allowed.has(id)) return true;
    if (!listedAnywhere.has(id)) return true;
    if (def?.effect === 'cell_power' || def?.effect === 'cell_tick' || def?.effect === 'cell_perpetual') return true;
    return false;
  };
}

function mapRevivalUpgrade(u) {
  const mapped = REVIVAL_EFFECTS[u.actionId] || REVIVAL_EFFECTS[u.id] || {};
  const isAcceleratorHeat = u.type === 'experimental_particle_accelerators'
    || (typeof u.id === 'string' && u.id.startsWith('improved_particle_accelerators'));
  return {
    id: u.id,
    title: u.title,
    description: u.description || null,
    baseCost: u.ecost != null ? u.ecost : u.cost,
    costMultiplier: u.multiplier ?? 2,
    maxLevel: u.levels ?? null,
    currency: u.ecost != null ? 'ep' : 'money',
    erequires: u.erequires ? [u.erequires] : undefined,
    effect: isAcceleratorHeat ? 'accelerator_ep_heat' : (mapped.effect || u.actionId || 'custom'),
    value: mapped.value ?? 1,
    category: mapped.category,
    partLevel: u.part_level ?? mapped.partLevel ?? null,
    type: u.type || null,
    icon: u.icon || null,
    section: u.type || null,
  };
}

export function createRevivalUpgradeStore(manifest, options = {}) {
  const flatUpgrades = (manifest.upgrades || []).map(mapRevivalUpgrade);

  flatUpgrades.push(
    ...buildCellPowerUpgrades(manifest.components),
    ...buildCellTickUpgrades(manifest.components),
    ...buildCellPerpetualUpgrades(manifest.components),
  );

  const canPurchaseExtra = options.canPurchaseExtra
    ?? createTechTreePurchaseGate(manifest);

  return createUpgradeStore(
    { ...manifest, upgrades: flatUpgrades },
    { canPurchaseExtra },
  );
}

const PLATING_CATEGORIES = new Set(['reactor_plating', 'plating']);
const CAPACITOR_CATEGORIES = new Set(['capacitor']);

function partLevel(inst) {
  const level = inst?.definition?.level;
  return Number.isFinite(level) && level > 0 ? level : 1;
}

export function sumCategoryLevels(grid, categories) {
  const set = categories instanceof Set ? categories : new Set(categories);
  let total = 0;
  grid.forEach((_, __, inst) => {
    if (!inst) return;
    if (set.has(inst.definition.category) || set.has(inst.definition.type)) total += partLevel(inst);
  });
  return total;
}

export function computeGridMultiplierBonuses(grid, modifiers = {}) {
  const platingLevels = sumCategoryLevels(grid, PLATING_CATEGORIES);
  const capacitorLevels = sumCategoryLevels(grid, CAPACITOR_CATEGORIES);
  const transferPlating = modifiers.transferPlatingMultiplier || 0;
  const transferCapacitor = modifiers.transferCapacitorMultiplier || 0;
  const ventPlating = modifiers.ventPlatingMultiplier || 0;
  const ventCapacitor = modifiers.ventCapacitorMultiplier || 0;
  const transferMultiplier = 1
    + (transferPlating * platingLevels + transferCapacitor * capacitorLevels) / 100;
  const ventMultiplier = 1
    + (ventPlating * platingLevels + ventCapacitor * capacitorLevels) / 100;
  const transferAdditivePercent = (transferMultiplier - 1) * 100;
  const ventAdditivePercent = (ventMultiplier - 1) * 100;
  return Object.freeze({
    platingLevels,
    capacitorLevels,
    transferMultiplier,
    ventMultiplier,
    transfer_multiplier_eff: transferMultiplier,
    vent_multiplier_eff: ventMultiplier,
    transferAdditivePercent,
    ventAdditivePercent,
    transfer_multiplier_add: transferAdditivePercent,
    vent_multiplier_add: ventAdditivePercent,
  });
}

export function baseTransferRate(inst) {
  const def = inst.definition;
  for (const key of ['transferRate', 'transfer', 'baseTransfer']) {
    const value = def[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

export function baseVentRate(inst) {
  const def = inst.definition;
  return def.vent ?? def.baseVent ?? 0;
}

export function resolveTransferRate(inst, bonuses = {}) {
  return baseTransferRate(inst) * (bonuses.transferMultiplier ?? 1);
}

export function resolveVentRate(inst, bonuses = {}) {
  return baseVentRate(inst) * (bonuses.ventMultiplier ?? 1);
}

export function resolveContainment(inst) {
  return inst?.definition?.containment || inst?.definition?.baseContainment || 0;
}

export function resolveDisplayRates(instOrDef, grid, modifiers = {}) {
  const inst = instOrDef?.definition ? instOrDef : { definition: instOrDef };
  if (!inst.definition) return null;
  const bonuses = computeGridMultiplierBonuses(grid, modifiers);
  return Object.freeze({
    vent: resolveVentRate(inst, bonuses),
    transfer: resolveTransferRate(inst, bonuses),
    containment: resolveContainment(inst),
    baseVent: baseVentRate(inst),
    baseTransfer: baseTransferRate(inst),
    bonuses,
  });
}

export function resolvePartDisplayRates(partIdOrDef, session) {
  if (!session) return null;
  const def = typeof partIdOrDef === 'string'
    ? session.registry?.get?.(partIdOrDef)
    : (partIdOrDef?.definition || partIdOrDef);
  if (!def) return null;
  return resolveDisplayRates(
    { definition: def },
    session.grid,
    session.modifiers || {},
  );
}

export function resolveSessionModifiers(ctx) {
  return ctx.session?.modifiers
    || ctx.upgrades?.compileModifiers?.()
    || {};
}

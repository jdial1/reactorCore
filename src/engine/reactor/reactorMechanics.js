const VALVE_OVERFLOW_THRESHOLD = 0.8;
const HEAT_REMOVAL_TARGET_RATIO = 0.1;
const REACTOR_HEAT_STANDARD_DIVISOR = 10000;

function toNum(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toNumber === 'function') return value.toNumber();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function effectiveMaxPower(grid, overrides) {
  const altered = toNum(overrides?.alteredMaxPower);
  if (altered > 0) return altered;
  return grid.maxPower;
}

export function applyPowerOverflowToCurrent(grid, overrides = {}) {
  const cap = effectiveMaxPower(grid, overrides);
  const ratio = toNum(
    overrides.powerOverflowToHeatRatio
    ?? overrides.power_overflow_to_heat_ratio
    ?? 1,
  );
  if (grid.currentPower > cap) {
    grid.adjustCurrentHeat((grid.currentPower - cap) * ratio);
    grid.currentPower = cap;
  }
}

export function applyPowerMultiplier(grid, basePowerAdd, overrides = {}) {
  const mult = toNum(overrides.powerMultiplier) || 1;
  if (mult === 1 || !(basePowerAdd > 0)) return;
  const cap = effectiveMaxPower(grid, overrides);
  const ratio = toNum(overrides.powerOverflowToHeatRatio ?? 0.5);
  const extra = basePowerAdd * (mult - 1);
  const potential = grid.currentPower + extra;
  if (potential > cap) {
    grid.adjustCurrentHeat((potential - cap) * ratio);
    grid.currentPower = cap;
  } else {
    grid.currentPower = potential;
  }
}

export function applyHeatReductions(ctx) {
  const { grid, session, upgrades, multiplier = 1 } = ctx;
  const overrides = session?.mechanicsOverrides ?? {};
  const powerToHeat = overrides.powerToHeatRatio != null
    ? toNum(overrides.powerToHeatRatio)
    : toNum(ctx.upgrades?.getModifier?.('power_to_heat_ratio')
      ?? ctx.upgrades?.getModifier?.('powerToHeatRatio')
      ?? 0);

  if (powerToHeat > 0 && grid.currentHeat > 0 && grid.currentPower > 0) {
    const heatPercent = grid.currentHeat / (grid.maxHeat || 1);
    if (heatPercent > VALVE_OVERFLOW_THRESHOLD) {
      const heatTarget = grid.currentHeat * HEAT_REMOVAL_TARGET_RATIO;
      const powerNeeded = heatTarget / powerToHeat;
      const powerUsed = Math.min(grid.currentPower, powerNeeded);
      const heatRemoved = powerUsed * powerToHeat;
      grid.currentPower -= powerUsed;
      grid.adjustCurrentHeat(-heatRemoved);
    }
  }

  const heatControlled = session?.toggles?.heat_control;
  if (heatControlled && grid.currentHeat > 0) {
    const ventBonus = toNum(upgrades?.getModifier?.('vent_multiplier_eff') ?? overrides.ventMultiplierEff);
    const reduction = (grid.maxHeat / REACTOR_HEAT_STANDARD_DIVISOR) * (1 + ventBonus / 100) * multiplier;
    grid.adjustCurrentHeat(-reduction);
  }

  if (grid.currentHeat < 0) grid.currentHeat = 0;
}

export function runReactorMechanicsPhase(ctx) {
  const overrides = {
    ...(ctx.session?.modifiers || {}),
    ...(ctx.session?.mechanicsOverrides ?? {}),
  };
  if (!overrides.alteredMaxPower) overrides.alteredMaxPower = ctx.grid.maxPower;
  if (overrides.powerOverflowToHeatRatio == null) {
    overrides.powerOverflowToHeatRatio = ctx.manifest?.mechanics?.economy?.powerOverflowToHeatRatio ?? 1;
  }
  applyPowerOverflowToCurrent(ctx.grid, overrides);
  applyPowerMultiplier(ctx.grid, ctx.result.powerOutput ?? 0, overrides);
  applyHeatReductions(ctx);
}

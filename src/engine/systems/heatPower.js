const HEAT_POWER_LOG_BASE = 1000;
const HEAT_POWER_LOG_CAP = 1e100;
const HEAT_POWER_PERCENT_DIVISOR = 100;

export function heatPowerMultiplier(hpm, currentHeat) {
  if (!hpm || hpm <= 0 || !currentHeat || currentHeat <= 0) return 1;
  const heatNum = Math.min(currentHeat, HEAT_POWER_LOG_CAP);
  const mult = 1 + hpm * (Math.log(heatNum) / Math.log(HEAT_POWER_LOG_BASE) / HEAT_POWER_PERCENT_DIVISOR);
  return Number.isFinite(mult) && mult > 0 ? mult : 1;
}

export { HEAT_POWER_LOG_BASE, HEAT_POWER_LOG_CAP, HEAT_POWER_PERCENT_DIVISOR };

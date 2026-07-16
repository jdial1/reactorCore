import { toNumber } from './decimal.js';

export function calculateWeaveEp(sessionPowerProduced, sessionHeatDissipated, weaveQuantum = 1_000_000) {
  const power = toNumber(sessionPowerProduced);
  const heat = toNumber(sessionHeatDissipated);
  const quantum = Number(weaveQuantum) > 0 ? Number(weaveQuantum) : 1_000_000;
  return Math.floor(Math.min(power, heat) / quantum);
}

export function previewPrestige(session, options = {}) {
  const economy = session?.systems?.economy;
  const weaveQuantum = economy?.weaveQuantum
    ?? session?.manifest?.economy?.weaveQuantum
    ?? 1_000_000;
  const sessionPowerProduced = economy?.sessionPowerProduced ?? 0;
  const sessionHeatDissipated = economy?.sessionHeatDissipated ?? 0;
  const earned = typeof economy?.calculatePrestigeReward === 'function'
    ? economy.calculatePrestigeReward()
    : calculateWeaveEp(sessionPowerProduced, sessionHeatDissipated, weaveQuantum);
  let fuelCellCount = 0;
  session?.grid?.forEach?.((_, __, inst) => {
    if (inst?.definition?.category === 'cell' && inst.ticks > 0) fuelCellCount += 1;
  });
  const keepEp = options.keepEp != null ? !!options.keepEp : !options.refundEp;
  return {
    keepEp,
    refundEp: options.refundEp === true,
    weaveQuantum,
    earned,
    fuelCellCount,
    sessionPowerProduced: toNumber(sessionPowerProduced),
    sessionHeatDissipated: toNumber(sessionHeatDissipated),
  };
}

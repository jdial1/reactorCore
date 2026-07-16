import { toNumber } from './decimal.js';

export const CATALYST_REDUCTION_CAP = 0.75;
export const DEFAULT_WEAVE_QUANTUM = 1_000_000;

export function resolveEpHeat(baseEpHeat, options = {}) {
  const base = Number(baseEpHeat) || 0;
  if (!(base > 0)) return 0;

  const partLevel = options.partLevel ?? options.level ?? 1;
  const upgradeLevel = options.acceleratorEpHeatByLevel?.[partLevel]
    ?? options.upgradeLevel
    ?? 0;
  const epHeatMultiplier = upgradeLevel + 1;

  const weaveQuantum = options.weaveQuantum || DEFAULT_WEAVE_QUANTUM;
  const ep = toNumber(options.exoticParticles ?? options.currentExoticParticles ?? 0);
  let epHeatScale = 1;
  if (ep > weaveQuantum) {
    const scale = 1 + Math.log10(ep / weaveQuantum);
    if (Number.isFinite(scale)) epHeatScale = scale;
  }

  let value = base * epHeatMultiplier * epHeatScale;
  const catalyst = options.catalystReduction ?? 0;
  if (catalyst > 0) {
    value *= 1 - Math.min(CATALYST_REDUCTION_CAP, catalyst);
  }
  return Math.max(0, Number.isFinite(value) ? value : 0);
}

export function createInstance(definition, extra = {}) {
  const rawTicks = extra.ticks ?? definition.baseTicks ?? definition.ticks ?? 0;
  const ticks = typeof rawTicks === 'number' && Number.isFinite(rawTicks)
    ? Math.floor(rawTicks)
    : 0;
  return {
    definition,
    currentHeat: 0,
    currentDamage: 0,
    pendingDestruction: false,
    enrichmentProgress: 0,
    converted: false,
    ticks,
    _hullHeating: 0,
    _componentHeating: 0,
    _hullCooling: 0,
    _ventCooling: 0,
    _cellCooling: 0,
    _condensatorCooling: 0,
    _euGenerated: 0,
    _heatGenerated: 0,
    _powerGenerated: 0,
  };
}

export function cloneInstance(inst) {
  return {
    definition: inst.definition,
    currentHeat: inst.currentHeat,
    currentDamage: inst.currentDamage,
    pendingDestruction: false,
    enrichmentProgress: inst.enrichmentProgress || 0,
    converted: inst.converted || false,
    ticks: inst.ticks || 0,
    _hullHeating: 0,
    _componentHeating: 0,
    _hullCooling: 0,
    _ventCooling: 0,
    _cellCooling: 0,
    _condensatorCooling: 0,
    _euGenerated: 0,
    _heatGenerated: 0,
    _powerGenerated: 0,
  };
}

export function preTick(instance) {
  instance._hullHeating = 0;
  instance._componentHeating = 0;
  instance._hullCooling = 0;
  instance._ventCooling = 0;
  instance._cellCooling = 0;
  instance._condensatorCooling = 0;
  instance._euGenerated = 0;
  instance._heatGenerated = 0;
  instance._powerGenerated = 0;
  instance.pendingDestruction = false;
}

export function isBroken(instance) {
  return instance.currentHeat >= instance.definition.maxHeat ||
         instance.currentDamage >= instance.definition.maxDamage;
}

export function isHeatAcceptor(instance) {
  return instance.definition.maxHeat > 1 && !isBroken(instance);
}

export function isCoolable(instance) {
  return instance.definition.maxHeat > 1 && !instance.definition.isCondensator;
}

export function adjustCurrentHeat(instance, heat) {
  if (typeof instance.definition.adjustCurrentHeat === 'function') {
    return instance.definition.adjustCurrentHeat(instance, heat);
  }
  if (!isHeatAcceptor(instance)) return heat;
  const def = instance.definition;
  let tempHeat = instance.currentHeat + heat;
  let overflow = 0;
  if (tempHeat > def.maxHeat) { overflow = tempHeat - def.maxHeat; tempHeat = def.maxHeat; }
  else if (tempHeat < 0) { overflow = tempHeat; tempHeat = 0; }
  instance.currentHeat = tempHeat;
  return overflow;
}

export function applyDamage(instance, damage) {
  if (instance.definition.maxDamage > 1 && damage > 0) {
    instance.currentDamage += damage;
  }
}

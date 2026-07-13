function createDef(fields) {
  return Object.freeze({
    maxHeat: 1,
    maxDamage: 1,
    category: 'valve',
    generateHeat: () => 0,
    generateEnergy: () => 0,
    dissipate: () => 0,
    transfer: () => 0,
    ...fields,
    displayName: fields.displayName || fields.title || fields.name || '',
  });
}

export function buildOverflowValve(spec) {
  return buildValve(spec, 'overflow');
}

export function buildTopupValve(spec) {
  return buildValve(spec, 'topup');
}

export function buildCheckValve(spec) {
  return buildValve(spec, 'check');
}

function buildValve(spec, valveKind) {
  const { id, title, baseTransfer = 0, level = 1 } = spec;
  const orientation = level;
  return createDef({
    id,
    name: id,
    title,
    displayName: title,
    category: 'valve',
    valveKind,
    valveGroup: spec.valve_group ?? valveKind,
    orientation,
    transfer: baseTransfer || spec.transfer || 0,
    containment: 0,
    maxHeat: 0,
    activationThreshold: spec.activation_threshold ?? null,
    transferDirection: spec.transfer_direction ?? null,
    transferMultiplier: spec.transfer_multiplier ?? 1,
    isValve: true,
  });
}

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
  const rawTransfer = baseTransfer || spec.transfer || 0;
  const transferMultiplier = Number(spec.transfer_multiplier) > 0
    ? Number(spec.transfer_multiplier)
    : 1;
  const transfer = rawTransfer * transferMultiplier;
  return createDef({
    id,
    name: id,
    title,
    displayName: title,
    category: 'valve',
    valveKind,
    valveGroup: spec.valve_group ?? valveKind,
    orientation,
    baseTransfer: rawTransfer,
    transfer,
    transferRate: transfer,
    containment: 0,
    maxHeat: 0,
    activationThreshold: spec.activation_threshold ?? null,
    transferDirection: spec.transfer_direction ?? null,
    transferMultiplier,
    isValve: true,
  });
}

const SINGLE_CELL_DESC_TPL = 'Creates %power power. Creates %heat heat. Lasts %ticks ticks.';
const MULTI_CELL_DESC_TPL = 'Acts as %count %type cells. Creates %power power. Creates %heat heat. Lasts %ticks ticks';
const TITLE_PREFIX_STRIP = /Dual |Quad /;
const CELL_COUNTS_BY_LEVEL = [1, 2, 4];

const PLACEHOLDER_SPECS = [
  { token: '%count', kind: 'text', unitKey: 'CELL_COUNT', field: 'cellCountForDesc' },
  { token: '%type', kind: 'text', unitKey: 'CELL_TYPE', field: 'typeLabel' },
  { token: '%power_increase', kind: 'stat', unitKey: 'POWER_INCREASE_UNITS', field: 'powerIncrease' },
  { token: '%heat_increase', kind: 'stat', unitKey: 'HEAT_INCREASE_UNITS', field: 'heatIncrease', places: 0 },
  { token: '%reactor_power', kind: 'stat', unitKey: 'REACTOR_POWER_UNITS', field: 'reactorPower' },
  { token: '%reactor_heat', kind: 'stat', unitKey: 'REACTOR_HEAT_UNITS', field: 'reactorHeat', places: 0 },
  { token: '%ticks', kind: 'stat', unitKey: 'TICKS_UNITS', field: 'baseTicks' },
  { token: '%containment', kind: 'stat', unitKey: 'CONTAINMENT_UNITS', field: 'containment', places: 0 },
  { token: '%ep_heat', kind: 'stat', unitKey: 'EP_HEAT_UNITS', field: 'epHeat', places: 0 },
  { token: '%range', kind: 'stat', unitKey: 'RANGE_UNITS', field: 'range' },
  { token: '%power', kind: 'stat', unitKey: 'POWER_UNITS', field: 'power' },
  { token: '%heat', kind: 'stat', unitKey: 'HEAT_UNITS', field: 'heat', places: 0 },
  { token: '%transfer', kind: 'stat', unitKey: 'TRANSFER_UNITS', field: 'transfer' },
  { token: '%vent', kind: 'stat', unitKey: 'VENT_UNITS', field: 'vent' },
];

function defaultFmt(value, places) {
  const n = Number(value) || 0;
  if (places == null) return String(n);
  return n.toFixed(places);
}

function resolveTemplate(compiled, templateOverride) {
  const raw = templateOverride
    ?? compiled?.baseDescription
    ?? compiled?.definition?.baseDescription
    ?? compiled?.definition?.base_description
    ?? compiled?.definition?.description
    ?? null;
  if (raw === '%single_cell_description') return SINGLE_CELL_DESC_TPL;
  if (raw === '%multi_cell_description') return MULTI_CELL_DESC_TPL;
  if (raw) return raw;
  const cellCount = compiled?.cellCount ?? 1;
  if (compiled?.category === 'cell') {
    return cellCount > 1 ? MULTI_CELL_DESC_TPL : SINGLE_CELL_DESC_TPL;
  }
  return '';
}

function buildValues(compiled, extras = {}) {
  const levelIndex = Math.max(0, (compiled?.level || 1) - 1);
  const cellCountForDesc = extras.cellCount
    ?? CELL_COUNTS_BY_LEVEL[levelIndex]
    ?? compiled?.cellCount
    ?? 1;
  const title = compiled?.title || compiled?.id || '';
  return {
    cellCountForDesc,
    typeLabel: extras.typeLabel ?? title.replace(TITLE_PREFIX_STRIP, ''),
    powerIncrease: compiled?.powerIncrease ?? 0,
    heatIncrease: compiled?.heatIncrease ?? 0,
    reactorPower: compiled?.reactorPower ?? 0,
    reactorHeat: compiled?.reactorHeat ?? 0,
    baseTicks: compiled?.baseTicks ?? 0,
    containment: compiled?.containment ?? 0,
    epHeat: compiled?.epHeat ?? 0,
    range: extras.range ?? compiled?.definition?.range ?? 1,
    power: extras.power ?? compiled?.power ?? compiled?.basePower ?? 0,
    heat: extras.heat ?? compiled?.heat ?? compiled?.baseHeat ?? 0,
    transfer: extras.transfer ?? compiled?.transfer ?? 0,
    vent: extras.vent ?? compiled?.vent ?? 0,
  };
}

export function formatPartDescription(compiledPart, template, extras = {}) {
  const tpl = resolveTemplate(compiledPart, template);
  const values = buildValues(compiledPart, extras);
  const fmtFn = extras.fmt || defaultFmt;
  const segments = [];
  for (let i = 0; i < PLACEHOLDER_SPECS.length; i++) {
    const spec = PLACEHOLDER_SPECS[i];
    if (!tpl.includes(spec.token)) continue;
    const value = values[spec.field];
    const seg = { kind: spec.kind, unitKey: spec.unitKey, value };
    if (spec.places != null) seg.places = spec.places;
    segments.push(seg);
  }
  let text = tpl;
  text = text.replace(/%power_increase/g, fmtFn(values.powerIncrease));
  text = text.replace(/%heat_increase/g, fmtFn(values.heatIncrease, 0));
  text = text.replace(/%reactor_power/g, fmtFn(values.reactorPower));
  text = text.replace(/%reactor_heat/g, fmtFn(values.reactorHeat, 0));
  text = text.replace(/%ticks/g, fmtFn(values.baseTicks));
  text = text.replace(/%containment/g, fmtFn(values.containment, 0));
  text = text.replace(/%ep_heat/g, fmtFn(values.epHeat, 0));
  text = text.replace(/%range/g, fmtFn(values.range));
  text = text.replace(/%count/g, String(values.cellCountForDesc));
  text = text.replace(/%power/g, fmtFn(values.power));
  text = text.replace(/%heat/g, fmtFn(values.heat, 0));
  text = text.replace(/%transfer/g, fmtFn(values.transfer));
  text = text.replace(/%vent/g, fmtFn(values.vent));
  text = text.replace(/%type/g, values.typeLabel);
  return { text, segments, template: tpl };
}

export function getPartDescription(session, id, opts = {}) {
  const compiled = typeof session?.getPart === 'function'
    ? session.getPart(id)
    : null;
  if (!compiled) return { text: '', segments: [], template: '' };
  return formatPartDescription(compiled, opts.template, {
    transfer: opts.transfer,
    vent: opts.vent,
    power: opts.power,
    heat: opts.heat,
    range: opts.range,
    cellCount: opts.cellCount,
    typeLabel: opts.typeLabel,
    fmt: opts.fmt,
  });
}

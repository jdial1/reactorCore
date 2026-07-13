import {
  buildFuelRod, buildLegacyFuelRod, buildReflector, buildVent,
  buildExchanger, buildCoolant, buildLegacyCoolant, buildCondensator,
  buildPlating, buildBreeder,
} from './ic2.js';
import {
  buildOverflowValve, buildTopupValve, buildCheckValve,
} from './valves.js';
import {
  buildIncrementalCell, buildIncrementalReflector, buildIncrementalVent,
  buildIncrementalExchanger, buildIncrementalInlet, buildIncrementalOutlet, buildIncrementalCapacitor,
  buildIncrementalCoolant, buildIncrementalPlating, buildIncrementalAccelerator,
} from './incremental.js';

const IC2_BUILDERS = {
  fuel_rod: (spec) => spec.heatFormula === 'classic' ? buildLegacyFuelRod(spec) : buildFuelRod(spec),
  reflector: (spec, modifiers) => spec.baseTicks != null || spec.powerIncrease != null
    ? buildIncrementalReflector(spec, modifiers)
    : buildReflector(spec),
  vent: (spec, modifiers) => spec.selfVent != null
    ? buildVent(spec)
    : buildIncrementalVent(spec, modifiers),
  exchanger: buildExchanger,
  coolant: (spec) => spec.legacy ? buildLegacyCoolant(spec) : buildCoolant(spec),
  coolant_cell: (spec, modifiers) => {
    if (spec.containment != null) return buildIncrementalCoolant(spec, modifiers);
    return spec.legacy || spec.heatFormula === 'classic' ? buildLegacyCoolant(spec) : buildCoolant(spec);
  },
  plating: buildPlating,
  condensator: buildCondensator,
  breeder: buildBreeder,
  breeder_cell: buildBreeder,
};

const INCREMENTAL_BUILDERS = {
  cell: buildIncrementalCell,
  uranium: buildIncrementalCell,
  plutonium: buildIncrementalCell,
  thorium: buildIncrementalCell,
  seaborgium: buildIncrementalCell,
  dolorium: buildIncrementalCell,
  nefastium: buildIncrementalCell,
  protium: buildIncrementalCell,
  reflector: buildIncrementalReflector,
  vent: buildIncrementalVent,
  heat_inlet: buildIncrementalInlet,
  heat_outlet: buildIncrementalOutlet,
  heat_exchanger: buildIncrementalExchanger,
  capacitor: buildIncrementalCapacitor,
  coolant_cell: buildIncrementalCoolant,
  reactor_plating: buildIncrementalPlating,
  particle_accelerator: buildIncrementalAccelerator,
  overflow_valve: buildOverflowValve,
  topup_valve: buildTopupValve,
  check_valve: buildCheckValve,
};

export function buildBehavior(spec, modifiers = {}) {
  const type = spec.type;
  const builder = IC2_BUILDERS[type] || INCREMENTAL_BUILDERS[type];
  if (!builder) throw new Error(`Unknown component type: ${type}`);
  return typeof builder === 'function' ? builder(spec, modifiers) : builder(spec);
}

export function buildDefinitionsFromManifest(manifest, modifiers = {}) {
  return manifest.components.map((spec) => buildBehavior(spec, modifiers));
}

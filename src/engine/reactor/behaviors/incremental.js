import { forEachNeighbor, countNeighborsWith } from '../../kernel/neighbors.js';
import { isBroken, adjustCurrentHeat, applyDamage } from '../createInstance.js';
import { deterministicUnitInterval } from '../../kernel/deterministic-tick-rng.js';
import { resolveEpHeat } from '../../systems/epHeat.js';

const ACCELERATOR_EP_SALT = 0xacce1;

function specStat(spec, name) {
  const base = `base${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  const value = spec[name] ?? spec[base];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function createDef(fields) {
  return Object.freeze({
    maxHeat: 1,
    maxDamage: 1,
    category: '',
    generateHeat: () => 0,
    generateEnergy: () => 0,
    dissipate: () => 0,
    transfer: () => 0,
    ...fields,
    displayName: fields.displayName || fields.title || fields.name || '',
  });
}

export function buildIncrementalCell(spec, modifiers = {}) {
  const {
    id, title, category, cellCount = 1,
    pulseMultiplier = 1, cellMultiplier = 1, baseCost, level = 1,
  } = spec;
  let basePower = specStat(spec, 'power');
  const baseHeat = specStat(spec, 'heat');
  let baseTicks = specStat(spec, 'ticks') || spec.baseTicks || 0;
  const partType = spec.type || '';
  const powerLevel = modifiers.cellPowerByType?.[partType] || 0;
  if (powerLevel > 0) basePower *= Math.pow(2, powerLevel);
  const tickLevel = modifiers.cellTicksByType?.[partType] || 0;
  if (tickLevel > 0) baseTicks = Math.floor(baseTicks * Math.pow(2, tickLevel));
  const ticksMult = modifiers.cellTicksMultiplier || 1;
  if (ticksMult !== 1) baseTicks = Math.max(1, baseTicks * ticksMult);
  if (partType === 'protium' && (modifiers.unstableProtiumLevel || 0) > 0) {
    baseTicks = Math.max(1, baseTicks * Math.pow(0.5, modifiers.unstableProtiumLevel));
  }
  const tickLife = Math.max(1, Math.floor(baseTicks));

  const perpetual = !!(modifiers.perpetualPartIds?.[id] || spec.perpetual);

  return createDef({
    id,
    name: id,
    title,
    type: partType,
    category: category || 'cell',
    displayName: title,
    maxHeat: 1,
    maxDamage: tickLife,
    basePower,
    baseHeat,
    baseTicks,
    baseCost,
    cellCount,
    pulseMultiplier,
    cellMultiplier,
    level,
    rodCount: cellCount,
    perpetual,

    generateHeat(instance, grid, row, col, ctx) {
      if (instance.ticks <= 0) return 0;
      let pulses = 0;
      forEachNeighbor(grid, row, col, (n) => {
        if (!isBroken(n) && n.definition.pulseMultiplier) pulses += n.definition.pulseMultiplier;
      });
      if (spec.axisAdjacent && ctx?.axisPulse) pulses += ctx.axisPulse(instance, grid, row, col);

      const mult = cellMultiplier + pulses;
      let heat = Math.floor(baseHeat * mult * mult / cellCount);
      const heatMult = modifiers.heatMultiplier || 1;
      heat = Math.floor(heat * heatMult);

      instance._heatGenerated = heat;
      instance._hullHeating = heat;
      grid.adjustCurrentHeat(heat);
      return heat;
    },

    generateEnergy(instance, grid, row, col, ctx) {
      if (instance.ticks <= 0) return 0;
      let pulses = 0;
      forEachNeighbor(grid, row, col, (n) => {
        if (!isBroken(n) && n.definition.pulseMultiplier) pulses += n.definition.pulseMultiplier;
      });
      if (spec.axisAdjacent && ctx?.axisPulse) pulses += ctx.axisPulse(instance, grid, row, col);

      const mult = cellMultiplier + pulses;
      let power = Math.floor(basePower * mult);
      const powerMult = modifiers.powerMultiplier || 1;
      const fissionBonus = modifiers.fissionBonus?.(grid.currentHeat) || 1;
      power = Math.floor(power * powerMult * fissionBonus);

      instance._powerGenerated = power;
      grid.addPower(power);
      instance.ticks -= 1;
      instance.currentDamage = tickLife - instance.ticks;
      if (instance.ticks <= 0) instance.pendingDestruction = true;
      return power;
    },
  });
}

export function buildIncrementalReflector(spec, modifiers = {}) {
  const { id, title, category, baseCost } = spec;
  const basePowerIncrease = specStat(spec, 'powerIncrease');
  const heatIncrease = specStat(spec, 'heatIncrease');
  let baseTicks = specStat(spec, 'ticks') || spec.baseTicks || 0;
  const durMult = modifiers.reflectorDurationMultiplier || 1;
  if (durMult !== 1) baseTicks = Math.max(1, Math.floor(baseTicks * durMult));
  const powerPercent = modifiers.reflectorPowerPercent || 0;
  const powerBonusLevels = modifiers.reflectorPowerBonusLevels || 0;
  const legacyPowerMult = modifiers.reflectorPowerMultiplier || 1;
  const powerIncrease = basePowerIncrease
    * (1 + powerPercent)
    * legacyPowerMult
    + basePowerIncrease * powerBonusLevels;
  const neighborPulseValue = Math.max(0, 1 + (powerIncrease || 0) / 100);
  const tickLife = Math.max(1, Math.floor(baseTicks));
  return createDef({
    id, name: id, title, category: category || 'reflector', displayName: title,
    maxHeat: 1, maxDamage: tickLife, baseTicks, baseCost,
    pulseMultiplier: 1, powerIncrease, heatIncrease, neighborPulseValue,
    isNeutronReflector: (inst) => !isBroken(inst) && inst.ticks > 0,
    generateHeat(instance, grid, row, col) {
      if (instance.ticks > 0) {
        instance.ticks -= 1;
        instance.currentDamage = tickLife - instance.ticks;
        if (instance.ticks <= 0) instance.pendingDestruction = true;
      }
      return 0;
    },
  });
}

export function buildIncrementalVent(spec, modifiers = {}) {
  const { id, title, category, baseCost } = spec;
  const vent = specStat(spec, 'vent');
  const containment = specStat(spec, 'containment');
  const effectiveVent = Math.floor(vent * (modifiers.ventEffectiveness || 1));
  const effectiveContainment = Math.floor(containment * (modifiers.ventCapacity || 1));

  return createDef({
    id, name: id, title, category: category || 'vent', displayName: title,
    maxHeat: effectiveContainment, vent: effectiveVent, containment: effectiveContainment, baseCost,
    ventConsumesPower: !!spec.ventConsumesPower,

    dissipate(instance, grid, row, col) {
      const removed = Math.min(effectiveVent, instance.currentHeat);
      instance.currentHeat -= removed;
      grid.ventHeat(removed);
      instance._ventCooling = removed;
      return removed;
    },
  });
}

export function buildIncrementalExchanger(spec, modifiers = {}) {
  const { id, title, category, baseCost } = spec;
  const transfer = specStat(spec, 'transfer');
  const containment = specStat(spec, 'containment');
  const effectiveTransfer = Math.floor(transfer * (modifiers.transferEffectiveness || 1));
  const effectiveContainment = Math.floor(containment * (modifiers.transferCapacity || 1));

  return createDef({
    id, name: id, title, category: category || 'heat_exchanger', displayName: title,
    maxHeat: effectiveContainment, transferRate: effectiveTransfer, containment: effectiveContainment, baseCost,

    dissipate(instance, grid, row, col) {
      const removed = Math.min(effectiveTransfer, instance.currentHeat);
      instance.currentHeat -= removed;
      grid.ventHeat(removed);
      return removed;
    },

    transfer(instance, grid, row, col) {
      forEachNeighbor(grid, row, col, (n) => {
        const diff = instance.currentHeat - n.currentHeat;
        if (diff === 0) return;
        const moved = Math.min(Math.abs(diff), effectiveTransfer) * Math.sign(diff);
        adjustCurrentHeat(instance, -moved);
        adjustCurrentHeat(n, moved);
      });
    },
  });
}

export function buildIncrementalInlet(spec, modifiers = {}) {
  const { id, title, category, baseCost } = spec;
  const transfer = specStat(spec, 'transfer');
  const effectiveTransfer = Math.floor(transfer * (modifiers.transferEffectiveness || 1));

  return createDef({
    id, name: id, title, category: category || 'heat_inlet', displayName: title,
    maxHeat: 1, transferRate: effectiveTransfer, baseCost,

    transfer(instance, grid, row, col) {
      forEachNeighbor(grid, row, col, (n) => {
        if (n.currentHeat > 0) {
          const moved = Math.min(effectiveTransfer, n.currentHeat);
          adjustCurrentHeat(n, -moved);
          grid.adjustCurrentHeat(moved);
        }
      });
    },
  });
}

export function buildIncrementalOutlet(spec, modifiers = {}) {
  const { id, title, category, baseCost } = spec;
  const transfer = specStat(spec, 'transfer');
  const effectiveTransfer = Math.floor(transfer * (modifiers.transferEffectiveness || 1));

  return createDef({
    id, name: id, title, category: category || 'heat_outlet', displayName: title,
    maxHeat: 1, transferRate: effectiveTransfer, baseCost,

    transfer(instance, grid, row, col) {
      if (grid.currentHeat <= 0) return;
      let remaining = effectiveTransfer;
      forEachNeighbor(grid, row, col, (n) => {
        if (remaining <= 0) return;
        const space = n.definition.containment - n.currentHeat;
        if (space > 0) {
          const moved = Math.min(remaining, grid.currentHeat, space);
          grid.adjustCurrentHeat(-moved);
          adjustCurrentHeat(n, moved);
          remaining -= moved;
        }
      });
    },
  });
}

export function buildIncrementalCapacitor(spec, modifiers = {}) {
  const { id, title, category, autoSellPercent = 0, baseCost, extreme = false, level = 1 } = spec;
  const reactorPower = specStat(spec, 'reactorPower') || specStat(spec, 'power');
  const containment = specStat(spec, 'containment');
  const reinforce = 1 + (modifiers.componentReinforcement || 0);
  const effectivePower = Math.floor(reactorPower * (modifiers.powerCapacity || 1));
  const effectiveContainment = Math.floor(containment * (modifiers.heatCapacity || 1) * reinforce);

  return createDef({
    id, name: id, title, category: category || 'capacitor', displayName: title,
    maxHeat: effectiveContainment, power: 0, reactorPower: effectivePower,
    powerAdjustment: effectivePower, containment: effectiveContainment,
    autoSellPercent, baseCost, extreme, level,
    capacitorAutosellHeatRatio: spec.capacitorAutosellHeatRatio || 0,
  });
}

export function buildIncrementalCoolant(spec, modifiers = {}) {
  const { id, title, category, baseCost, extreme = false, heatTakePercent = 0 } = spec;
  const containment = specStat(spec, 'containment');
  const reinforce = 1 + (modifiers.componentReinforcement || 0);
  const effectiveContainment = Math.floor(containment * (modifiers.coolantCapacity || 1) * reinforce);

  return createDef({
    id, name: id, title, category: category || 'coolant_cell', displayName: title,
    maxHeat: effectiveContainment, containment: effectiveContainment, baseCost, extreme, heatTakePercent,

    adjustCurrentHeat(instance, heat) {
      if (heat < 0) {
        instance.currentHeat = Math.max(0, instance.currentHeat + heat);
        return 0;
      }
      if (extreme && heatTakePercent > 0) {
        const taken = Math.floor(heat * heatTakePercent);
        heat -= taken;
      }
      const space = effectiveContainment - instance.currentHeat;
      const accepted = Math.min(heat, space);
      instance.currentHeat += accepted;
      return heat - accepted;
    },
  });
}

export function buildIncrementalPlating(spec, modifiers = {}) {
  const { id, title, category, baseCost, level = 1 } = spec;
  const reactorHeat = specStat(spec, 'reactorHeat') || specStat(spec, 'containment');
  const reactorPower = specStat(spec, 'reactorPower');
  const reinforce = 1 + (modifiers.componentReinforcement || 0);
  const heatMult = (modifiers.platingCapacity || 1) * (1 + (modifiers.platingHeatBonus || 0)) * reinforce;
  const effectiveHeat = reactorHeat * heatMult;
  const effectivePower = Math.floor(reactorPower * (modifiers.powerCapacity || 1));

  return createDef({
    id, name: id, title, category: category || 'reactor_plating', displayName: title,
    heatAdjustment: effectiveHeat,
    reactorHeat: effectiveHeat,
    reactorPower: effectivePower,
    powerAdjustment: effectivePower,
    baseCost,
    level,
  });
}

export function buildIncrementalAccelerator(spec, modifiers = {}) {
  const { id, title, category, baseCost, level = 1 } = spec;
  const baseEpHeat = specStat(spec, 'epHeat');
  const epChance = spec.epChance ?? spec.baseEpChance ?? 0;
  const containment = specStat(spec, 'containment');
  const epHeatOptions = {
    partLevel: level,
    acceleratorEpHeatByLevel: modifiers.acceleratorEpHeatByLevel,
    catalystReduction: modifiers.catalystReduction || 0,
  };
  const epHeat = resolveEpHeat(baseEpHeat, epHeatOptions);

  return createDef({
    id, name: id, title, category: category || 'particle_accelerator', displayName: title,
    maxHeat: containment || 1, containment, baseEpHeat, epHeat, epChance, baseCost, level,

    generateEnergy(instance, grid, row, col, ctx) {
      const heldHeat = (typeof grid.getTileHeat === 'function' ? grid.getTileHeat(row, col) : 0) || instance.currentHeat;
      const threshold = resolveEpHeat(baseEpHeat, {
        ...epHeatOptions,
        exoticParticles: ctx?.economy?.currentExoticParticles,
        weaveQuantum: ctx?.economy?.weaveQuantum
          ?? ctx?.session?.systems?.economy?.weaveQuantum
          ?? ctx?.session?.manifest?.economy?.weaveQuantum,
      });
      if (!(heldHeat > 1) || !threshold || !ctx?.economy) return 0;
      const lowerHeat = Math.min(heldHeat, threshold);
      let chance = (Math.log(lowerHeat) / Math.LN10) * (lowerHeat / threshold);
      let epGain = 0;
      if (chance > 1) {
        epGain = Math.floor(chance);
        chance -= epGain;
      }
      const salt = (ACCELERATOR_EP_SALT ^ (row * 0x1f1f + col * 0x2e2e)) | 0;
      if (chance > deterministicUnitInterval(ctx.tickCount ?? 0, salt)) epGain++;
      if (epGain > 5) epGain = 5;
      if (epGain > 0) ctx.economy.addExoticParticles(epGain);
      return 0;
    },
  });
}

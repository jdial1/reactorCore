import { forEachNeighbor, countNeighborsWith } from '../../kernel/neighbors.js';
import {
  isBroken, isHeatAcceptor, isCoolable,
  adjustCurrentHeat, applyDamage,
} from '../createInstance.js';

function createDef(fields) {
  return Object.freeze({
    maxHeat: 1,
    maxDamage: 1,
    rodCount: 0,
    isCondensator: false,
    category: '',
    isNeutronReflector: () => false,
    getRodCount: () => 0,
    generateHeat: () => 0,
    generateEnergy: () => 0,
    dissipate: () => 0,
    transfer: () => 0,
    ...fields,
    displayName: fields.displayName || fields.name || '',
  });
}

export function buildFuelRod(spec) {
  const {
    id, exportId, name, maxDamage, energyMult, heatMult, rodCount, moxStyle, category, displayName,
  } = spec;
  const basePulses = rodCount === 1 ? 1 : rodCount === 2 ? 2 : 3;
  const isReflector = (n) => !isBroken(n) && n.definition.isNeutronReflector(n);

  return createDef({
    id, exportId, name, maxDamage, energyMult, heatMult, rodCount, moxStyle,
    category: category || 'fuel', displayName: displayName || name,
    isNeutronReflector: (inst) => !isBroken(inst),
    getRodCount: () => rodCount,

    generateHeat(instance, grid, row, col) {
      const pulses = countNeighborsWith(grid, row, col, isReflector) + basePulses;
      let heat = Math.floor(heatMult * pulses * (pulses + 1));
      if (moxStyle && grid.fluid && (grid.currentHeat / grid.maxHeat) > 0.5) heat *= 2;
      instance._heatGenerated = heat;

      let acceptorCount = 0;
      forEachNeighbor(grid, row, col, (n) => { if (isHeatAcceptor(n)) acceptorCount++; });

      if (acceptorCount === 0) {
        instance._hullHeating = heat;
        grid.adjustCurrentHeat(heat);
      } else {
        instance._componentHeating = heat;
        const per = Math.floor(heat / acceptorCount);
        const rem = heat % acceptorCount;
        let idx = 0;
        forEachNeighbor(grid, row, col, (n) => {
          if (isHeatAcceptor(n)) {
            adjustCurrentHeat(n, per + (idx === 0 ? rem : 0));
            idx++;
          }
        });
      }
      return heat;
    },

    generateEnergy(instance, grid, row, col) {
      const pulses = countNeighborsWith(grid, row, col, isReflector) + basePulses;
      let eu = energyMult * pulses;
      if (moxStyle) eu = Math.floor(eu * (1 + 4.0 * grid.currentHeat / grid.maxHeat));

      if (grid.fluid) {
        instance._heatGenerated += eu;
        grid.ventHeat(eu);
        applyDamage(instance, 1);
        if (instance.currentDamage >= maxDamage) instance.pendingDestruction = true;
        return 0;
      }

      instance._euGenerated = eu;
      grid.addEUOutput(eu);
      applyDamage(instance, 1);
      if (instance.currentDamage >= maxDamage) instance.pendingDestruction = true;
      return eu;
    },
  });
}

export function buildLegacyFuelRod(spec) {
  const { id, exportId, name, maxDamage, rodCount = 1, category, displayName } = spec;

  return createDef({
    id, exportId, name, maxDamage, rodCount,
    category: category || 'fuel', displayName: displayName || name,
    isNeutronReflector: (inst) => !isBroken(inst),
    getRodCount: () => rodCount,

    generateHeat(instance, grid, row, col) {
      let uCount = 0;
      let cCount = 0;
      forEachNeighbor(grid, row, col, (n) => {
        if (isBroken(n)) return;
        if (n.definition.rodCount > 0 && !n.definition.moxStyle) uCount++;
        if (n.definition.isCoolantCell || n.definition.isHeatExchanger ||
            n.definition.isHeatVent || n.definition.isIntegratedHeatDisperser) cCount++;
      });
      const heat = (uCount + 1) * (10 - (Math.min(cCount, 4) - 1) * 2);
      instance._heatGenerated = heat;
      instance._hullHeating = heat;
      grid.adjustCurrentHeat(heat);
      return heat;
    },

    generateEnergy(instance, grid, row, col) {
      const uCount = countNeighborsWith(grid, row, col,
        (n) => !isBroken(n) && n.definition.rodCount > 0 && !n.definition.moxStyle);
      const eu = 100 * rodCount * (uCount + 1);
      instance._euGenerated = eu;
      grid.addEUOutput(eu);
      applyDamage(instance, 1);
      if (instance.currentDamage >= maxDamage) instance.pendingDestruction = true;
      return eu;
    },
  });
}

export function buildReflector(spec) {
  const { id, exportId, name, maxDamage, category, displayName } = spec;
  return createDef({
    id, exportId, name, maxDamage,
    category: category || 'reflector', displayName: displayName || name,
    isNeutronReflector: (inst) => !isBroken(inst),
    generateHeat(instance, grid, row, col) {
      forEachNeighbor(grid, row, col, (n) => {
        if (!isBroken(n) && n.definition.rodCount > 0) {
          applyDamage(instance, n.definition.rodCount);
        }
      });
      return 0;
    },
  });
}

export function buildVent(spec) {
  const { id, exportId, name, maxHeat, selfVent, hullDraw, sideVent, category, displayName } = spec;
  return createDef({
    id, exportId, name, maxHeat, selfVent, hullDraw, sideVent,
    category: category || 'vent', displayName: displayName || name,
    isHeatVent: true,

    dissipate(instance, grid, row, col) {
      let totalVented = 0;
      const deltaHeat = Math.min(hullDraw, grid.currentHeat);
      instance._hullCooling = deltaHeat;
      grid.adjustCurrentHeat(-deltaHeat);
      adjustCurrentHeat(instance, deltaHeat);

      const selfDissipated = Math.min(selfVent, instance.currentHeat);
      instance._ventCooling = selfDissipated;
      grid.ventHeat(selfDissipated);
      instance.currentHeat -= selfDissipated;
      totalVented += selfDissipated;

      if (sideVent > 0) {
        forEachNeighbor(grid, row, col, (neighbor) => {
          if (isCoolable(neighbor)) {
            const r = adjustCurrentHeat(neighbor, -sideVent);
            const netVented = sideVent + r;
            grid.ventHeat(netVented);
            instance._ventCooling += netVented;
            totalVented += netVented;
          }
        });
      }
      return totalVented;
    },
  });
}

function calcSideTransfer(myP, otherP, cap) {
  const sumP = otherP + myP / 2.0;
  let add = Math.floor(cap * sumP / 100.0);
  if (add > cap) add = cap;
  if (sumP < 1.0) add = Math.floor(cap / 2);
  if (sumP < 0.75) add = Math.floor(cap / 4);
  if (sumP < 0.5) add = Math.floor(cap / 8);
  if (sumP < 0.25) add = 1;
  const myR = Math.round(myP * 10) / 10;
  const otherR = Math.round(otherP * 10) / 10;
  return otherR > myR ? add : otherR === myR ? 0 : -add;
}

function calcHullTransfer(myP, hullP, cap) {
  const sumP = hullP + myP / 2.0;
  let add = Math.round(cap * sumP / 100.0);
  if (add > cap) add = cap;
  if (sumP < 1.0) add = Math.floor(cap / 2);
  if (sumP < 0.75) add = Math.floor(cap / 4);
  if (sumP < 0.5) add = Math.floor(cap / 8);
  if (sumP < 0.25) add = 1;
  const myR = Math.round(myP * 10) / 10;
  const hullR = Math.round(hullP * 10) / 10;
  return hullR > myR ? add : hullR === myR ? 0 : -add;
}

export function buildExchanger(spec) {
  const { id, exportId, name, maxHeat, switchSide, switchReactor, category, displayName } = spec;
  return createDef({
    id, exportId, name, maxHeat, switchSide, switchReactor,
    category: category || 'exchanger', displayName: displayName || name,
    isHeatExchanger: true,

    transfer(instance, grid, row, col) {
      let myHeatDelta = 0;
      const myPercent = (instance.currentHeat * 100.0) / instance.definition.maxHeat;

      if (switchSide > 0) {
        forEachNeighbor(grid, row, col, (neighbor) => {
          if (isHeatAcceptor(neighbor)) {
            const add = calcSideTransfer(myPercent, (neighbor.currentHeat * 100.0) / neighbor.definition.maxHeat, switchSide);
            myHeatDelta -= add;
            if (add > 0) instance._componentHeating += add;
            myHeatDelta += adjustCurrentHeat(neighbor, add);
          }
        });
      }

      if (switchReactor > 0) {
        const add = calcHullTransfer(myPercent, (grid.currentHeat * 100.0) / grid.maxHeat, switchReactor);
        myHeatDelta -= add;
        grid.adjustCurrentHeat(add);
        if (add > 0) instance._hullHeating = add;
        else instance._hullCooling = -add;
      }

      adjustCurrentHeat(instance, myHeatDelta);
    },
  });
}

export function buildCoolant(spec) {
  const { id, exportId, name, maxHeat, category, displayName } = spec;
  return createDef({
    id, exportId, name, maxHeat,
    category: category || 'coolant', displayName: displayName || name,
    adjustCurrentHeat(instance, heat) {
      instance._cellCooling += heat;
      if (!isHeatAcceptor(instance)) return heat;
      let tempHeat = instance.currentHeat + heat;
      let overflow = 0;
      if (tempHeat > maxHeat) { overflow = tempHeat - maxHeat; tempHeat = maxHeat; }
      else if (tempHeat < 0) { overflow = tempHeat; tempHeat = 0; }
      instance.currentHeat = tempHeat;
      return overflow;
    },
  });
}

export function buildLegacyCoolant(spec) {
  const { id, exportId, name, maxHeat, category, displayName } = spec;
  return createDef({
    id, exportId, name, maxHeat, isCoolantCell: true,
    category: category || 'coolant', displayName: displayName || name,
    adjustCurrentHeat(instance, heat) {
      if (instance.pendingDestruction) return heat;
      if (heat < 0) { instance.currentHeat = Math.max(0, instance.currentHeat + heat); return 0; }
      const newHeat = instance.currentHeat + heat;
      if (newHeat >= maxHeat) {
        instance.pendingDestruction = true;
        instance.currentHeat = maxHeat;
        return newHeat - maxHeat;
      }
      instance.currentHeat = newHeat;
      return 0;
    },
  });
}

export function buildCondensator(spec) {
  const { id, exportId, name, maxHeat, category, displayName } = spec;
  return createDef({
    id, exportId, name, maxHeat, isCondensator: true,
    category: category || 'condensator', displayName: displayName || name,
    adjustCurrentHeat(instance, heat) {
      if (heat < 0) return heat;
      instance._condensatorCooling += heat;
      const accepted = Math.min(heat, maxHeat - instance.currentHeat);
      instance.currentHeat += accepted;
      return heat - accepted;
    },
    needsCoolantInjected: (inst) => inst.currentHeat > 0.85 * maxHeat,
    injectCoolant: (inst) => { inst.currentHeat = 0; },
  });
}

export function buildPlating(spec) {
  const { id, exportId, name, heatAdjustment, powerAdjustment = 0, category, displayName } = spec;
  const explosionMultiplier = spec.explosionMultiplier ?? spec.explosionPowerMultiplier ?? 1;
  return createDef({
    id, exportId, name, heatAdjustment, powerAdjustment, explosionMultiplier,
    category: category || 'plating', displayName: displayName || name,
    onAddToGrid: (_, grid) => {
      grid.adjustMaxHeat(heatAdjustment);
      if (powerAdjustment) grid.adjustMaxPower(powerAdjustment);
    },
    onRemoveFromGrid: (_, grid) => {
      grid.adjustMaxHeat(-heatAdjustment);
      if (powerAdjustment) grid.adjustMaxPower(-powerAdjustment);
    },
  });
}

export function buildBreeder(spec) {
  const { id, exportId, name, maxDamage = 1, enrichmentThreshold = 10000, category, displayName } = spec;
  return createDef({
    id, exportId, name, maxDamage, isBreederCell: true, enrichmentThreshold,
    category: category || 'fuel', displayName: displayName || name,

    processEnrichment(instance, grid, row, col) {
      if (isBroken(instance) || instance.converted) return null;
      const neutronSource = countNeighborsWith(grid, row, col,
        (n) => !isBroken(n) && n.definition.rodCount > 0);
      if (neutronSource === 0) return { converted: false, enrichmentProgress: instance.enrichmentProgress };

      const heatPercent = grid.currentHeat / grid.maxHeat;
      const heatRate = heatPercent >= 0.9 ? 4.0 : heatPercent >= 0.7 ? 2.0 :
                       heatPercent >= 0.5 ? 1.0 : heatPercent >= 0.3 ? 0.5 : 0.1;
      instance.enrichmentProgress += heatRate * neutronSource;

      if (instance.enrichmentProgress >= enrichmentThreshold) {
        instance.converted = true;
        return { converted: true, enrichmentProgress: instance.enrichmentProgress };
      }
      return { converted: false, enrichmentProgress: instance.enrichmentProgress };
    },
  });
}

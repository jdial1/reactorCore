import { collectOverpressureExplosions } from '../explosions.js';
import {
  computeGridMultiplierBonuses,
  resolveContainment,
  resolveTransferRate,
  resolveVentRate,
  resolveSessionModifiers,
} from './effectiveRates.js';

const OFFSETS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const VALVE_OVERFLOW = 1;
const VALVE_TOPUP = 2;
const VALVE_CHECK = 3;
const HEAT_EPSILON = 0.001;

function idx(grid, row, col) {
  return grid.tileIndex(row, col);
}

function getValveOrientation(def) {
  const level = Number(def.level);
  return Number.isFinite(level) && level > 0 ? level | 0 : 1;
}

function getTwoNeighborOrientation(neighbors, orientation) {
  const a = neighbors[0];
  const b = neighbors[1];
  const isAFirst = (orientation === 1 || orientation === 3) ? (a.col < b.col) : (a.row < b.row);
  const first = isAFirst ? a : b;
  const last = isAFirst ? b : a;
  const invert = orientation === 3 || orientation === 4;
  return { inputNeighbor: invert ? last : first, outputNeighbor: invert ? first : last };
}

function getSortedNeighborOrientation(neighbors, orientation) {
  const sorted = [...neighbors].sort((a, b) =>
    (orientation === 1 || orientation === 3) ? (a.col - b.col) : (a.row - b.row));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const invert = orientation === 3 || orientation === 4;
  return { inputNeighbor: invert ? last : first, outputNeighbor: invert ? first : last };
}

function getInputOutputNeighbors(neighbors, orientation) {
  if (neighbors.length < 2) return { inputNeighbor: null, outputNeighbor: null };
  return neighbors.length === 2
    ? getTwoNeighborOrientation(neighbors, orientation)
    : getSortedNeighborOrientation(neighbors, orientation);
}

function getValveTypeId(def) {
  const type = def.type || def.valveKind || def.valveGroup;
  if (type === 'overflow_valve' || type === 'overflow') return VALVE_OVERFLOW;
  if (type === 'topup_valve' || type === 'topup') return VALVE_TOPUP;
  return VALVE_CHECK;
}

function collectContainmentNeighbors(grid, row, col, excludeValves = false) {
  const neighbors = [];
  for (let i = 0; i < 4; i++) {
    const nr = row + OFFSETS[i][0];
    const nc = col + OFFSETS[i][1];
    const inst = grid.getComponentAt(nr, nc);
    if (!inst) continue;
    if (excludeValves && inst.definition.category === 'valve') continue;
    if ((inst.definition.containment || 0) > 0 || inst.definition.category === 'heat_exchanger'
      || inst.definition.category === 'heat_inlet' || inst.definition.category === 'heat_outlet') {
      neighbors.push({ row: nr, col: nc, inst });
    }
  }
  return neighbors;
}

function collectPartNeighbors(grid, row, col, excludeRow, excludeCol) {
  const neighbors = [];
  for (let i = 0; i < 4; i++) {
    const nr = row + OFFSETS[i][0];
    const nc = col + OFFSETS[i][1];
    if (nr === excludeRow && nc === excludeCol) continue;
    const inst = grid.getComponentAt(nr, nc);
    if (inst) neighbors.push({ row: nr, col: nc, inst });
  }
  return neighbors;
}

function inputValveMustPointToUs(grid, inputNeighbor, valveRow, valveCol) {
  const inputDef = inputNeighbor.inst.definition;
  if (inputDef.category !== 'valve') return true;
  const orientation = getValveOrientation(inputDef);
  const inputValveNeighbors = collectPartNeighbors(grid, inputNeighbor.row, inputNeighbor.col, valveRow, valveCol);
  const { outputNeighbor } = getInputOutputNeighbors(inputValveNeighbors, orientation);
  return outputNeighbor && outputNeighbor.row === valveRow && outputNeighbor.col === valveCol;
}

function shouldSkipValveByRatio(def, inputNeighbor, outputNeighbor, grid, mechanics) {
  const overflowThreshold = mechanics.valve?.overflowThreshold ?? 0.8;
  const topupThreshold = mechanics.valve?.topupThreshold ?? 0.2;
  const typeId = getValveTypeId(def);
  if (typeId === VALVE_OVERFLOW) {
    const inputCap = inputNeighbor.inst.definition.containment || 1;
    const inputRatio = grid.getTileHeat(inputNeighbor.row, inputNeighbor.col) / inputCap;
    return inputRatio < overflowThreshold;
  }
  if (typeId === VALVE_TOPUP) {
    const outputCap = outputNeighbor.inst.definition.containment || 1;
    const outputRatio = grid.getTileHeat(outputNeighbor.row, outputNeighbor.col) / outputCap;
    return outputRatio > topupThreshold;
  }
  return false;
}

function buildContainmentArray(grid) {
  const len = grid.rows * grid.cols;
  const containment = new Float32Array(len);
  grid.forEach((row, col, inst) => {
    if (inst) containment[idx(grid, row, col)] = resolveContainment(inst);
  });
  return containment;
}

function syncHeatFromGrid(grid, heat) {
  grid.forEach((row, col) => {
    heat[idx(grid, row, col)] = grid.getTileHeat(row, col);
  });
}

function syncHeatToGrid(grid, heat) {
  grid.forEach((row, col) => {
    const i = idx(grid, row, col);
    grid.setTileHeat(row, col, heat[i] < HEAT_EPSILON ? 0 : heat[i]);
  });
}

function runInlets(heat, grid, reactorHeat, multiplier, bonuses) {
  let heatFromInlets = 0;
  grid.forEach((row, col, inst) => {
    if (!inst || inst.definition.category !== 'heat_inlet') return;
    const rate = resolveTransferRate(inst, bonuses) * multiplier;
    const neighbors = collectContainmentNeighbors(grid, row, col, true);
    for (let j = 0; j < neighbors.length; j++) {
      const n = neighbors[j];
      const nidx = idx(grid, n.row, n.col);
      const h = heat[nidx] || 0;
      const transfer = Math.min(rate, h);
      heat[nidx] -= transfer;
      reactorHeat += transfer;
      heatFromInlets += transfer;
    }
  });
  return { reactorHeat, heatFromInlets };
}

function resetValveHeatValues(grid, heat) {
  grid.forEach((row, col, inst) => {
    if (inst?.definition.category === 'valve') heat[idx(grid, row, col)] = 0;
  });
}

function runValves(heat, containment, grid, multiplier, mechanics, recordTransfers, bonuses) {
  const heatLen = heat.length;
  const snap = new Float32Array(heatLen);
  snap.set(heat);
  const valveEntries = [];
  grid.forEach((row, col, inst) => {
    if (!inst || inst.definition.category !== 'valve') return;
    const neighbors = collectPartNeighbors(grid, row, col);
    if (neighbors.length < 2) return;
    const orientation = getValveOrientation(inst.definition);
    const { inputNeighbor, outputNeighbor } = getInputOutputNeighbors(neighbors, orientation);
    if (!inputNeighbor || !outputNeighbor) return;
    if (!inputValveMustPointToUs(grid, inputNeighbor, row, col)) return;
    if (shouldSkipValveByRatio(inst.definition, inputNeighbor, outputNeighbor, grid, mechanics)) return;
    valveEntries.push({
      index: idx(grid, row, col),
      typeId: getValveTypeId(inst.definition),
      transferRate: resolveTransferRate(inst, bonuses),
      inputIdx: idx(grid, inputNeighbor.row, inputNeighbor.col),
      outputIdx: idx(grid, outputNeighbor.row, outputNeighbor.col),
    });
  });
  const topupCapRatio = mechanics.valve?.topupCapRatio ?? mechanics.valve?.topupThreshold ?? 0.2;
  for (let v = 0; v < valveEntries.length; v++) {
    const val = valveEntries[v];
    const inputHeat = snap[val.inputIdx] || 0;
    const outputCap = containment[val.outputIdx] || 1;
    const outputSpace = Math.max(0, outputCap - (snap[val.outputIdx] || 0));
    let maxTransfer = val.transferRate * multiplier;
    if (val.typeId === VALVE_TOPUP) maxTransfer = Math.min(maxTransfer, outputCap * topupCapRatio);
    const transfer = Math.min(maxTransfer, inputHeat, outputSpace);
    if (transfer > 0) {
      heat[val.inputIdx] = (heat[val.inputIdx] || 0) - transfer;
      heat[val.outputIdx] = (heat[val.outputIdx] || 0) + transfer;
      if (recordTransfers) recordTransfers.push({ fromIdx: val.inputIdx, toIdx: val.outputIdx, amount: transfer });
      snap[val.inputIdx] -= transfer;
      snap[val.outputIdx] = (snap[val.outputIdx] || 0) + transfer;
    }
  }
  resetValveHeatValues(grid, heat);
}

function buildValveFlags(grid, heatLen) {
  const flags = new Uint8Array(heatLen);
  grid.forEach((row, col, inst) => {
    if (!inst || inst.definition.category === 'valve') return;
    for (let i = 0; i < 4; i++) {
      const neighbor = grid.getComponentAt(row + OFFSETS[i][0], col + OFFSETS[i][1]);
      if (neighbor?.definition.category === 'valve') flags[idx(grid, row, col)] = 1;
    }
  });
  return flags;
}

function buildExchangerStartHeat(exchangers, heat) {
  const startHeat = new Float32Array(heat.length);
  startHeat.fill(-1);
  for (let e = 0; e < exchangers.length; e++) startHeat[exchangers[e].index] = heat[exchangers[e].index] || 0;
  return startHeat;
}

function getExchangerStartHeat(tileIdx, heat, valveFlags, startHeatMap) {
  if (valveFlags[tileIdx]) return heat[tileIdx] || 0;
  const sh = startHeatMap[tileIdx];
  return sh >= 0 ? sh : (heat[tileIdx] || 0);
}

function collectExchangerPush(heat, exchangers, valveFlags, startHeatMap, multiplier, mechanics, recordTransfers) {
  const diffDivisor = mechanics.exchanger?.diffDivisor ?? 2;
  for (let e = 0; e < exchangers.length; e++) {
    const ex = exchangers[e];
    const heatStart = getExchangerStartHeat(ex.index, heat, valveFlags, startHeatMap);
    const capStart = ex.containment || 1;
    const pressureStart = heatStart / capStart;
    const transferVal = ex.transferRate * multiplier;
    let remainingPush = heatStart;
    for (let n = 0; n < ex.neighbors.length; n++) {
      if (remainingPush <= 0) break;
      const nb = ex.neighbors[n];
      const nStart = getExchangerStartHeat(nb.index, heat, valveFlags, startHeatMap);
      const cap = nb.containment || 0;
      const pressureNeighbor = nStart / (cap || 1);
      if (pressureStart <= pressureNeighbor) continue;
      const diff = heatStart - nStart;
      const amt = Math.min(transferVal, diff / diffDivisor, remainingPush);
      if (amt > 0) {
        heat[ex.index] -= amt;
        heat[nb.index] += amt;
        if (recordTransfers) recordTransfers.push({ fromIdx: ex.index, toIdx: nb.index, amount: amt });
        remainingPush -= amt;
      }
    }
  }
}

function collectExchangerPull(heat, exchangers, valveFlags, startHeatMap, multiplier, mechanics, recordTransfers) {
  const diffDivisor = mechanics.exchanger?.diffDivisor ?? 2;
  const plannedOutByNeighbor = new Float32Array(heat.length);
  for (let e = 0; e < exchangers.length; e++) {
    const ex = exchangers[e];
    const heatStart = getExchangerStartHeat(ex.index, heat, valveFlags, startHeatMap);
    const transferVal = ex.transferRate * multiplier;
    for (let n = 0; n < ex.neighbors.length; n++) {
      const nb = ex.neighbors[n];
      const nStart = getExchangerStartHeat(nb.index, heat, valveFlags, startHeatMap);
      const alreadyOut = plannedOutByNeighbor[nb.index] || 0;
      const nAvailable = Math.max(0, nStart - alreadyOut);
      if (nAvailable <= 0 || nStart <= heatStart) continue;
      const diff = nStart - heatStart;
      const amt = Math.min(transferVal, Math.ceil(diff / diffDivisor), nAvailable);
      if (amt > 0) {
        heat[nb.index] -= amt;
        heat[ex.index] += amt;
        if (recordTransfers) recordTransfers.push({ fromIdx: nb.index, toIdx: ex.index, amount: amt });
        plannedOutByNeighbor[nb.index] = alreadyOut + amt;
      }
    }
  }
}

function runExchangers(heat, containment, grid, multiplier, mechanics, recordTransfers, bonuses) {
  const exchangers = [];
  grid.forEach((row, col, inst) => {
    if (!inst || inst.definition.category !== 'heat_exchanger') return;
    const neighbors = collectContainmentNeighbors(grid, row, col, true);
    exchangers.push({
      index: idx(grid, row, col),
      transferRate: resolveTransferRate(inst, bonuses),
      containment: resolveContainment(inst) || 1,
      neighbors: neighbors.map((n) => ({
        index: idx(grid, n.row, n.col),
        containment: resolveContainment(n.inst) || 0,
      })),
    });
  });
  const valveFlags = buildValveFlags(grid, heat.length);
  const startHeatMap = buildExchangerStartHeat(exchangers, heat);
  collectExchangerPush(heat, exchangers, valveFlags, startHeatMap, multiplier, mechanics, recordTransfers);
  collectExchangerPull(heat, exchangers, valveFlags, startHeatMap, multiplier, mechanics, recordTransfers);
}

function runOutlets(heat, grid, reactorHeat, multiplier, bonuses) {
  grid.forEach((row, col, inst) => {
    if (!inst || inst.definition.category !== 'heat_outlet') return;
    if (reactorHeat <= 0) return;
    const activated = grid.tileHeatMap?.isActivated(row, col) ?? true;
    if (!activated) return;
    const transferCap = resolveTransferRate(inst, bonuses) * multiplier;
    let toTransfer = Math.min(transferCap, reactorHeat);
    if (toTransfer <= 0) return;
    const neighbors = collectContainmentNeighbors(grid, row, col, true);
    const isOutlet6 = !!inst.definition.outletRespectNeighborCap;
    if (neighbors.length > 0) {
      const perNeighbor = toTransfer / neighbors.length;
      for (let n = 0; n < neighbors.length; n++) {
        const nb = neighbors[n];
        const nidx = idx(grid, nb.row, nb.col);
        const cap = resolveContainment(nb.inst);
        const current = heat[nidx] || 0;
        let add = perNeighbor;
        if (isOutlet6 && cap > 0) add = Math.min(add, Math.max(0, cap - current));
        add = Math.min(add, reactorHeat);
        if (add > 0) {
          heat[nidx] = current + add;
          reactorHeat -= add;
        }
      }
    } else {
      heat[idx(grid, row, col)] = (heat[idx(grid, row, col)] || 0) + toTransfer;
      reactorHeat -= toTransfer;
    }
  });
  return reactorHeat;
}

export function runHeatPipeline(ctx) {
  const { grid, manifest } = ctx;
  const mechanics = manifest.mechanics || {};
  const multiplier = ctx.multiplier ?? 1;
  const bonuses = computeGridMultiplierBonuses(grid, resolveSessionModifiers(ctx));
  const len = grid.rows * grid.cols;
  const heat = new Float32Array(len);
  const containment = buildContainmentArray(grid);
  syncHeatFromGrid(grid, heat);
  let reactorHeat = grid.currentHeat || 0;
  const recordTransfers = [];
  const inletResult = runInlets(heat, grid, reactorHeat, multiplier, bonuses);
  reactorHeat = inletResult.reactorHeat;
  runValves(heat, containment, grid, multiplier, mechanics, recordTransfers, bonuses);
  runExchangers(heat, containment, grid, multiplier, mechanics, recordTransfers, bonuses);
  reactorHeat = runOutlets(heat, grid, reactorHeat, multiplier, bonuses);
  for (let i = 0; i < len; i++) if (heat[i] < HEAT_EPSILON) heat[i] = 0;
  if (reactorHeat < HEAT_EPSILON) reactorHeat = 0;
  syncHeatToGrid(grid, heat);
  grid.currentHeat = reactorHeat;
  if (ctx.features.containmentExplosions) ctx.result.explosionSnapshot = collectOverpressureExplosions(ctx);
  ctx.result.heatFromInlets = inletResult.heatFromInlets;
  ctx.result.transferMultiplier = bonuses.transferMultiplier;
  ctx.result.heatTransfers = recordTransfers;
  ctx.result.heatFlowVectors = heatTransfersToVectors(recordTransfers, grid.cols);
  return { reactorHeat, heatFromInlets: inletResult.heatFromInlets, bonuses };
}

export function heatTransfersToVectors(transfers = [], cols = 1) {
  const width = Math.max(1, cols | 0);
  return Object.freeze(transfers.map(({ fromIdx, toIdx, amount }) => Object.freeze({
    fromRow: Math.floor(fromIdx / width),
    fromCol: fromIdx % width,
    toRow: Math.floor(toIdx / width),
    toCol: toIdx % width,
    amount,
  })));
}

export function copyHeatFlowVectors(vectors = []) {
  if (!vectors.length) return Object.freeze([]);
  return Object.freeze(vectors.map((v) => Object.freeze({
    fromRow: v.fromRow,
    fromCol: v.fromCol,
    toRow: v.toRow,
    toCol: v.toCol,
    amount: v.amount,
  })));
}

function countEmptyNeighbors(grid, row, col) {
  let count = 0;
  for (let i = 0; i < 4; i++) {
    const nr = row + OFFSETS[i][0];
    const nc = col + OFFSETS[i][1];
    if (nr < 0 || nr >= grid.rows || nc < 0 || nc >= grid.cols) continue;
    if (!grid.getComponentAt(nr, nc)) count++;
  }
  return count;
}

function effectiveVentRate(grid, row, col, inst, multiplier, convectiveBoost, bonuses) {
  let rate = resolveVentRate(inst, bonuses) * multiplier;
  if (rate > 0 && convectiveBoost > 0) {
    const empty = countEmptyNeighbors(grid, row, col);
    if (empty > 0) rate *= 1 + empty * convectiveBoost;
  }
  return rate;
}

export function runVentPhase(ctx) {
  const { grid } = ctx;
  const multiplier = ctx.multiplier ?? 1;
  const modifiers = resolveSessionModifiers(ctx);
  const bonuses = computeGridMultiplierBonuses(grid, modifiers);
  let powerAdd = 0;
  let ventHeat = 0;
  const stirling = ctx.session?.mechanicsOverrides?.stirlingMultiplier
    ?? modifiers.stirlingMultiplier
    ?? 0;
  const convectiveBoost = ctx.session?.mechanicsOverrides?.convectiveBoost
    ?? modifiers.convectiveBoost
    ?? 0;
  let poweredVentDemand = 0;
  grid.forEach((row, col, inst) => {
    if (!inst || inst.definition.category !== 'vent' || !inst.definition.ventConsumesPower) return;
    const rate = effectiveVentRate(grid, row, col, inst, multiplier, convectiveBoost, bonuses);
    if (rate <= 0) return;
    poweredVentDemand += Math.min(rate, grid.getTileHeat(row, col));
  });
  const powerVentScram = poweredVentDemand > 0 && grid.currentPower < poweredVentDemand;
  if (powerVentScram) ctx.result.powerVentScram = true;
  grid.forEach((row, col, inst) => {
    if (!inst || inst.definition.category !== 'vent') return;
    const consumesPower = !!inst.definition.ventConsumesPower;
    if (consumesPower && powerVentScram) {
      inst._ventCooling = 0;
      return;
    }
    const ventRate = effectiveVentRate(grid, row, col, inst, multiplier, convectiveBoost, bonuses);
    if (ventRate <= 0) return;
    const h = grid.getTileHeat(row, col);
    const ventReduce = Math.min(ventRate, h);
    if (consumesPower && ventReduce > 0) grid.currentPower -= ventReduce;
    grid.setTileHeat(row, col, h - ventReduce);
    ventHeat += ventReduce;
    inst._ventCooling = ventReduce;
    if (stirling > 0 && ventReduce > 0) powerAdd += ventReduce * stirling;
  });
  grid.ventHeat(ventHeat);
  if (powerAdd > 0) grid.addPowerRaw(powerAdd);
  ctx.result.ventedHeat = (ctx.result.ventedHeat || 0) + ventHeat;
  ctx.result.powerOutput = (ctx.result.powerOutput || 0) + powerAdd;
  ctx.result.stirlingPower = powerAdd;
  ctx.result.ventMultiplier = bonuses.ventMultiplier;
  return { powerAdd, ventHeat, bonuses };
}

export {
  getValveOrientation,
  getInputOutputNeighbors,
  getValveTypeId,
  resolveTransferRate,
  resolveVentRate,
  resolveContainment,
  computeGridMultiplierBonuses,
  VALVE_OVERFLOW,
  VALVE_TOPUP,
  VALVE_CHECK,
};

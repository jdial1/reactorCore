import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  isValidGridCoord,
  computeInstanceSellValue,
  computeGridSellCredit,
  applyBlueprintPayload,
  resolveVentRate,
  resolveTransferRate,
  resolveContainment,
  resolveCellCoefficients,
  computeCellOutput,
  countActiveReflectorNeighbors,
  createReactorGrid,
  runCellPhase,
} from '../src/index.js';

test('isValidGridCoord rejects non-integer and non-finite coords', () => {
  const grid = { rows: 12, cols: 12 };
  assert.equal(isValidGridCoord(0, 0, grid), true);
  assert.equal(isValidGridCoord(-1, 0, grid), false);
  assert.equal(isValidGridCoord(0.5, 0, grid), false);
  assert.equal(isValidGridCoord(NaN, 0, grid), false);
  assert.equal(isValidGridCoord(undefined, 0, grid), false);
  assert.equal(isValidGridCoord(null, 1, grid), false);
});

test('computeInstanceSellValue caps life ratio and rejects non-finite policy', () => {
  const cell = {
    definition: { baseCost: 10, baseTicks: 15 },
    ticks: 30,
  };
  assert.equal(computeInstanceSellValue(cell), 10);
  assert.equal(computeInstanceSellValue(cell, {
    computeSellValue: () => Infinity,
  }), 0);
  assert.equal(computeInstanceSellValue(cell, {
    computeSellValue: () => NaN,
  }), 0);
  assert.equal(computeInstanceSellValue(cell, {
    computeSellValue: () => 7,
  }), 7);
});

test('computeGridSellCredit empty shape includes sellMultiplier', () => {
  assert.deepEqual(computeGridSellCredit(null), {
    total: 0,
    items: [],
    sellMultiplier: 0.5,
  });
});

test('applyBlueprintPayload sellExisting preflights without mutating', () => {
  const cells = new Map();
  const money = { v: 0 };
  const session = {
    grid: {
      rows: 2,
      cols: 2,
      getComponentAt(r, c) { return cells.get(`${r},${c}`) || null; },
      forEach(fn) {
        for (const [k, inst] of cells) {
          const [r, c] = k.split(',').map(Number);
          fn(r, c, inst);
        }
      },
      recalculateCaps() {},
    },
    systems: {
      economy: {
        get money() { return money.v; },
        currentExoticParticles: 0,
        addMoney(n) { money.v += n; },
        spendMoney() { return false; },
      },
    },
    removeComponent(r, c) { cells.delete(`${r},${c}`); },
    placeComponent() { return true; },
    registry: {
      get(id) {
        return id === 'uranium1'
          ? { id, baseCost: 10, baseTicks: 15, level: 1 }
          : { id, baseCost: 50, level: 1 };
      },
    },
    manifest: { components: [] },
    modifiers: {},
    toggles: {},
  };
  cells.set('0,0', {
    definition: { id: 'uranium1', baseCost: 10, baseTicks: 15, level: 1 },
    ticks: 7,
  });
  const result = applyBlueprintPayload(session, {
    layout: [[{ id: 'expensive', lvl: 1 }, null], [null, null]],
    sellExisting: true,
    sellMode: 'instance',
    sellCredit: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'deficit');
  assert.equal(cells.size, 1);
  assert.equal(money.v, 0);
});

test('effective rates ignore host _effective* fields', () => {
  const inst = {
    definition: { vent: 10, transfer: 5, containment: 20 },
    _effectiveVent: 999,
    _effectiveTransfer: 999,
    _effectiveContainment: 999,
  };
  const bonuses = { ventMultiplier: 2, transferMultiplier: 3 };
  assert.equal(resolveVentRate(inst, bonuses), 20);
  assert.equal(resolveTransferRate(inst, bonuses), 15);
  assert.equal(resolveContainment(inst), 20);
});

test('dual/quad cells use single-cell basePower with cellMultiplier pulse', () => {
  const def = { basePower: 1, baseHeat: 1, cellCount: 2, cellMultiplier: 4, type: 'uranium' };
  const coeffs = resolveCellCoefficients(def, {});
  assert.equal(coeffs.power, 1);
  const out = computeCellOutput(def, {}, 4, 0, 0, 1, {});
  assert.equal(out.layoutPower, 4);
  assert.equal(out.generatedHeat, (1 * 16) / 2);
});

test('honorHostEffective can come from options for cell output', () => {
  const def = { basePower: 1, baseHeat: 1, cellCount: 1 };
  const inst = { _effectivePower: 42, _effectiveHeat: 7 };
  const honored = computeCellOutput(def, inst, 1, 0, 0, 1, { honorHostEffective: true });
  assert.equal(honored.layoutPower, 42);
  assert.equal(honored.generatedHeat, 7);
  const core = computeCellOutput(def, inst, 1, 0, 0, 1, {});
  assert.equal(core.layoutPower, 1);
});

test('countActiveReflectorNeighbors counts live reflectors only', () => {
  const grid = {
    getComponentAt(r, c) {
      if (r === 0 && c === 1) return { definition: { category: 'reflector' }, ticks: 2 };
      if (r === 1 && c === 0) return { definition: { category: 'reflector' }, ticks: 0 };
      return null;
    },
  };
  assert.equal(countActiveReflectorNeighbors(grid, 0, 0), 1);
});

test('revival parts.json bakes tier-scaled capacitor/plating caps', () => {
  const parts = JSON.parse(readFileSync(new URL('../src/games/reactor_revival/parts.json', import.meta.url), 'utf8'));
  const byId = new Map(parts.components.map((c) => [c.id, c]));
  assert.equal(byId.get('capacitor2').reactorPower, 14000);
  assert.equal(byId.get('capacitor2').containment, 50);
  assert.equal(byId.get('capacitor5').reactorPower, 100 * Math.pow(140, 4));
  assert.equal(byId.get('reactor_plating2').reactorHeat, 37500);
  assert.equal(byId.get('reactor_plating5').reactorHeat, 250 * Math.pow(150, 4));
});

test('recalculateCaps applies reactorHeat and reactorPower', () => {
  const grid = createReactorGrid({
    gridDefaults: { rows: 2, cols: 2, baseMaxHeat: 1000, baseMaxPower: 100 },
    features: {},
  });
  grid.setComponentAt(0, 0, {
    definition: { id: 'capacitor2', category: 'capacitor', reactorPower: 14000, containment: 50, maxHeat: 1 },
    currentHeat: 0,
    currentDamage: 0,
    ticks: 0,
  });
  grid.setComponentAt(0, 1, {
    definition: { id: 'reactor_plating2', category: 'reactor_plating', reactorHeat: 37500, maxHeat: 1 },
    currentHeat: 0,
    currentDamage: 0,
    ticks: 0,
  });
  grid.recalculateCaps();
  assert.equal(grid.maxPower, 100 + 14000);
  assert.equal(grid.maxHeat, 1000 + 37500);
});

test('runCellPhase honors session.mechanicsOverrides.honorHostEffective', () => {
  const def = {
    id: 'uranium1',
    category: 'cell',
    basePower: 1,
    baseHeat: 1,
    cellCount: 1,
    cellMultiplier: 1,
    baseTicks: 15,
    maxHeat: 1,
    maxDamage: 15,
  };
  const inst = {
    definition: def,
    ticks: 15,
    currentHeat: 0,
    currentDamage: 0,
    _effectivePower: 42,
    _effectiveHeat: 7,
  };
  function makeCtx(overrides) {
    const grid = createReactorGrid({
      gridDefaults: { rows: 1, cols: 1, baseMaxHeat: 1000, baseMaxPower: 1000 },
      features: {},
    });
    grid.setComponentAt(0, 0, inst);
    inst.ticks = 15;
    grid.currentPower = 0;
    grid.currentHeat = 0;
    return {
      grid,
      multiplier: 1,
      session: { modifiers: {}, mechanicsOverrides: overrides },
      result: {},
    };
  }
  const honored = runCellPhase(makeCtx({ honorHostEffective: true }));
  assert.equal(honored.powerAdd, 42);
  assert.equal(honored.heatAdd, 7);
  const core = runCellPhase(makeCtx({}));
  assert.equal(core.powerAdd, 1);
  assert.equal(core.heatAdd, 1);
});

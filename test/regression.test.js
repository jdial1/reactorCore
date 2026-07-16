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
  createHookBus,
  createEventQueue,
  createAchievementSystem,
  createRevivalUpgradeStore,
  createGameSession,
} from '../src/index.js';
import {
  buildIncrementalCapacitor,
  buildIncrementalPlating,
  buildIncrementalCoolant,
  buildIncrementalCell,
} from '../src/engine/reactor/behaviors/incremental.js';
import { createRevivalAchievements } from '../src/games/reactor_revival/progression.js';
import Decimal from 'decimal.js';

globalThis.Decimal = Decimal;

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

test('inst.power/heat override cell output without honorHostEffective', () => {
  const def = { basePower: 1, baseHeat: 1, cellCount: 1 };
  const inst = { power: 42, heat: 7 };
  const out = computeCellOutput(def, inst, 1, 0, 0, 1, {});
  assert.equal(out.layoutPower, 42);
  assert.equal(out.generatedHeat, 7);
});

test('component_reinforcement scales capacitor/plating on compile', () => {
  const cap = buildIncrementalCapacitor(
    { id: 'capacitor1', title: 'C', containment: 10, reactorPower: 100 },
    { componentReinforcement: 0.1 },
  );
  assert.equal(cap.containment, 11);
  const plate = buildIncrementalPlating(
    { id: 'reactor_plating1', title: 'P', reactorHeat: 250 },
    { componentReinforcement: 0.1 },
  );
  assert.equal(plate.reactorHeat, 275);
  assert.equal(plate.heatAdjustment, 275);
  const cool = buildIncrementalCoolant(
    { id: 'coolant_cell1', title: 'Cool', containment: 80 },
    { componentReinforcement: 0.1 },
  );
  assert.equal(cool.containment, 88);
});

test('isotope stabilization keeps fractional baseTicks for sell ratios', () => {
  const def = buildIncrementalCell(
    { id: 'uranium1', title: 'U', type: 'uranium', category: 'cell', power: 1, heat: 1, ticks: 15, cellCount: 1 },
    { cellTicksMultiplier: 1.05 },
  );
  assert.equal(def.baseTicks, 15.75);
  assert.equal(def.maxDamage, 15);
  const value = computeInstanceSellValue({ definition: { ...def, baseCost: 10 }, ticks: 15 });
  assert.equal(value, Math.ceil(10 * (15 / 15.75)));
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

test('operator upgrade costs match host parity', () => {
  const upgrades = JSON.parse(readFileSync(new URL('../src/games/reactor_revival/upgrades.json', import.meta.url), 'utf8'));
  const byId = new Map(upgrades.map((u) => [u.id, u]));
  assert.equal(byId.get('auto_sell_operator').cost, 50000);
  assert.equal(byId.get('auto_buy_operator').cost, 100000);
  const store = createRevivalUpgradeStore({ upgrades, components: [], techTree: [] });
  assert.equal(store.getDefinition('auto_sell_operator').baseCost, 50000);
  assert.equal(store.getDefinition('auto_buy_operator').baseCost, 100000);
  assert.equal(store.getDefinition('auto_sell_operator').effect, 'auto_sell_toggle');
  assert.equal(store.getDefinition('auto_buy_operator').effect, 'auto_buy_toggle');
});

test('recompile rebinds placed coolant containment from reinforcement', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  session.systems.economy.addMoney(1_000_000);
  assert.equal(session.placeComponent(0, 0, 'coolant_cell1'), true);
  const inst = session.grid.getComponentAt(0, 0);
  const oldDef = inst.definition;
  const baseContainment = oldDef.containment;
  assert.equal(baseContainment, 2000);
  assert.equal(session.purchaseUpgrade('component_reinforcement'), true);
  assert.equal(inst.definition.containment, Math.floor(baseContainment * 1.1));
  assert.equal(inst.definition.maxHeat, Math.floor(baseContainment * 1.1));
  assert.notEqual(inst.definition, oldDef);
});

test('criticality_recovery aborts on full vent after entry even if vented before', () => {
  const hooks = createHookBus();
  const events = createEventQueue(hooks);
  const achievements = createRevivalAchievements({
    components: [],
    achievements: [{
      id: 'ach_criticality_recovery',
      triggerType: 'tick',
      checkId: 'criticality_recovery_auto',
    }],
  }, { hooks });

  function evalAt(heatRatio) {
    const maxHeat = 100;
    const grid = {
      maxHeat,
      currentHeat: heatRatio * maxHeat,
      countCategory: () => 0,
      forEach() {},
    };
    return achievements.evaluate({
      grid,
      session: { modifiers: {}, paused: false },
      upgrades: null,
      failure: null,
      economy: {},
      result: { destroyedComponents: [], meltdown: false },
    });
  }

  events.emit('soldHeat', { amount: 10 });
  assert.deepEqual(evalAt(1.6), []);
  events.emit('soldHeat', { amount: 10 });
  assert.deepEqual(evalAt(0.5), []);
  assert.equal(achievements.isUnlocked('ach_criticality_recovery'), false);

  assert.deepEqual(evalAt(1.6), []);
  assert.deepEqual(evalAt(0.5), ['ach_criticality_recovery']);
  assert.equal(achievements.isUnlocked('ach_criticality_recovery'), true);
});

test('prestige achievements require keepEp true', () => {
  const hooks = createHookBus();
  const events = createEventQueue(hooks);
  const achievements = createRevivalAchievements({
    components: [],
    achievements: [
      { id: 'ach_nuclear_disarmament', triggerType: 'event', triggerEvent: 'prestigeCompleted' },
      { id: 'ach_perfect_weave', triggerType: 'event', triggerEvent: 'prestigeCompleted' },
      { id: 'ach_any_prestige', triggerType: 'event', triggerEvent: 'prestigeCompleted' },
    ],
  }, { hooks });

  events.emit('prestigeCompleted', {
    keepEp: false,
    fuelCellCount: 1,
    sessionPowerProduced: 1000,
    sessionHeatDissipated: 1000,
  });
  assert.equal(achievements.isUnlocked('ach_any_prestige'), false);

  events.emit('prestigeCompleted', {
    keepEp: true,
    fuelCellCount: 1,
    sessionPowerProduced: 1000,
    sessionHeatDissipated: 1000,
  });
  assert.equal(achievements.isUnlocked('ach_nuclear_disarmament'), true);
  assert.equal(achievements.isUnlocked('ach_perfect_weave'), true);
  assert.equal(achievements.isUnlocked('ach_any_prestige'), true);
});

test('full VENT_HEAT ventHeat+soldHeat pair counts once', () => {
  const hooks = createHookBus();
  const events = createEventQueue(hooks);
  const achievements = createRevivalAchievements({
    components: [],
    achievements: [{
      id: 'ach_criticality_recovery',
      triggerType: 'tick',
      checkId: 'criticality_recovery_auto',
    }],
  }, { hooks });

  function fullVent() {
    events.emit('ventHeat', { amount: 10, remaining: 0 });
    events.emit('soldHeat', { amount: 10 });
  }

  fullVent();
  fullVent();
  const paired = achievements.serialize();
  assert.equal(paired.soldHeatCount, 2);

  events.emit('soldHeat', { amount: 5 });
  const standalone = achievements.serialize();
  assert.equal(standalone.soldHeatCount, 3);
});

test('achievement serialize persists trackers and soldHeatCount', () => {
  const hooks = createHookBus();
  const events = createEventQueue(hooks);
  const achievements = createRevivalAchievements({
    components: [],
    achievements: [{
      id: 'ach_criticality_recovery',
      triggerType: 'tick',
      checkId: 'criticality_recovery_auto',
    }],
  }, { hooks });

  events.emit('soldHeat', { amount: 1 });
  achievements.evaluate({
    grid: { maxHeat: 100, currentHeat: 160, countCategory: () => 0, forEach() {} },
    session: { modifiers: {}, paused: false },
    economy: {},
    result: { destroyedComponents: [], meltdown: false },
  });

  const snap = achievements.serialize();
  assert.equal(snap.soldHeatCount, 1);
  assert.equal(snap.trackers.criticality_recovery_auto.recovery.phase, 'critical');
  assert.equal(snap.trackers.criticality_recovery_auto.recovery.soldHeatCountAtEntry, 1);
  assert.ok(Array.isArray(snap.unlocked));
  assert.ok(snap.sustained);

  const hooks2 = createHookBus();
  const restored = createRevivalAchievements({
    components: [],
    achievements: [{
      id: 'ach_criticality_recovery',
      triggerType: 'tick',
      checkId: 'criticality_recovery_auto',
    }],
  }, { hooks: hooks2 });
  restored.deserialize(snap);
  const again = restored.serialize();
  assert.equal(again.soldHeatCount, 1);
  assert.equal(again.trackers.criticality_recovery_auto.recovery.phase, 'critical');
});

test('achievement unlock emits aliases and unlockedAchievementIds', () => {
  const hooks = createHookBus();
  const events = createEventQueue(hooks);
  const session = { events, achievements: [] };
  const system = createAchievementSystem({
    achievements: [{ id: 'ach_lab', triggerType: 'tick', checkId: 'lab_unlocked' }],
  }, {
    hooks,
    instantChecks: { lab_unlocked: () => true },
  });

  const result = { destroyedComponents: [], meltdown: false };
  const unlocked = system.evaluate({
    session,
    grid: { forEach() {}, maxHeat: 1, currentHeat: 0, countCategory: () => 0 },
    result,
  });
  assert.deepEqual(unlocked, ['ach_lab']);
  assert.deepEqual(result.unlockedAchievementIds, ['ach_lab']);

  const drained = events.drain();
  const types = drained.map((e) => e.type);
  assert.ok(types.includes('achievementUnlocked'));
  assert.ok(types.includes('ACHIEVEMENT_UNLOCKED'));
  assert.equal(drained.find((e) => e.type === 'achievementUnlocked').payload.id, 'ach_lab');
  assert.equal(drained.find((e) => e.type === 'ACHIEVEMENT_UNLOCKED').payload.id, 'ach_lab');
});

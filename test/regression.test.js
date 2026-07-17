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
  buildAutoReplaceCosts,
  partAutoReplaceCost,
  calculateWeaveEp,
  previewPrestige,
  resolveEpHeat,
  heatPowerMultiplier,
  projectCellOutputs,
  describeCellPulse,
  deriveReactorStats,
  toNumber,
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

test('listParts exposes compiled containment and baseTicks', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  session.systems.economy.addMoney(1_000_000);
  const before = session.getPart('coolant_cell1');
  assert.equal(before.containment, 2000);
  assert.equal(session.purchaseUpgrade('component_reinforcement'), true);
  assert.equal(session.purchaseUpgrade('isotope_stabilization'), true);
  const cool = session.getPart('coolant_cell1');
  assert.equal(cool.containment, 2200);
  const cell = session.getPart('uranium1');
  assert.equal(cell.baseTicks, 15.75);
  const listed = session.listParts();
  assert.ok(listed.some((p) => p.id === 'uranium1' && p.baseTicks === 15.75));
});

test('resolveDisplayRates applies grid plating/capacitor bonuses', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  session.systems.economy.addMoney(10_000_000);
  assert.equal(session.placeComponent(0, 0, 'vent1'), true);
  const base = session.resolveDisplayRates('vent1');
  assert.ok(base.vent > 0);
  assert.equal(base.vent, base.baseVent);
  assert.equal(session.placeComponent(0, 1, 'reactor_plating1'), true);
  assert.equal(session.purchaseUpgrade('improved_heatsinks'), true);
  const boosted = session.resolveDisplayRates(session.grid.getComponentAt(0, 0));
  assert.ok(boosted.vent > boosted.baseVent);
  assert.ok(boosted.bonuses.ventMultiplier > 1);
});

test('autoReplaceCosts match host perpetual formulas', () => {
  const parts = [
    { id: 'uranium1', category: 'cell', baseCost: 10 },
    { id: 'capacitor1', category: 'capacitor', baseCost: 1000 },
    { id: 'vent1', category: 'vent', baseCost: 50 },
  ];
  const none = buildAutoReplaceCosts(parts, {});
  assert.equal(none.uranium1, 10);
  assert.equal(none.capacitor1, 1000);
  assert.equal(none.vent1, 50);

  const perpetual = buildAutoReplaceCosts(parts, {
    perpetualPartIds: { uranium1: true },
    perpetualCategories: { capacitor: true },
  });
  assert.equal(perpetual.uranium1, 15);
  assert.equal(perpetual.capacitor1, 10000);
  assert.equal(perpetual.vent1, 50);
  assert.equal(partAutoReplaceCost(parts[1], { perpetualCategories: { capacitor: true } }), 10000);
});

test('previewPrestige and calculateWeaveEp match weave quantum', () => {
  assert.equal(calculateWeaveEp(5_000_000, 2_000_000, 1_000_000), 2);
  assert.equal(calculateWeaveEp(100, 200, 1_000_000), 0);
  const preview = previewPrestige({
    manifest: { economy: { weaveQuantum: 1000 } },
    systems: {
      economy: {
        sessionPowerProduced: 5000,
        sessionHeatDissipated: 4000,
        weaveQuantum: 1000,
        calculatePrestigeReward() { return 4; },
      },
    },
    grid: { forEach(fn) { fn(0, 0, { definition: { category: 'cell' }, ticks: 3 }); } },
  }, { keepEp: true });
  assert.equal(preview.earned, 4);
  assert.equal(preview.weaveQuantum, 1000);
  assert.equal(preview.keepEp, true);
  assert.equal(preview.fuelCellCount, 1);
});

test('session.computeSellValue uses fractional compiled baseTicks', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  session.systems.economy.addMoney(1_000_000);
  assert.equal(session.purchaseUpgrade('isotope_stabilization'), true);
  assert.equal(session.placeComponent(0, 0, 'uranium1'), true);
  const inst = session.grid.getComponentAt(0, 0);
  assert.equal(inst.definition.baseTicks, 15.75);
  assert.equal(inst.ticks, 15);
  const value = session.computeSellValue(0, 0);
  assert.equal(value, Math.ceil(10 * (15 / 15.75)));
});

test('improved_heat_vents doubles vent rate and capacity on compiled defs', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  session.systems.economy.addMoney(10_000_000);
  const before = session.getPart('vent1');
  assert.equal(session.purchaseUpgrade('improved_heat_vents'), true);
  const after = session.getPart('vent1');
  assert.equal(after.vent, before.vent * 2);
  assert.equal(after.containment, before.containment * 2);
});

test('reflector duration and power upgrades compile into listParts', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  session.systems.economy.addMoney(10_000_000);
  session.systems.economy.addExoticParticles(500);
  const before = session.getPart('reflector1');
  assert.equal(before.baseTicks, 100);
  assert.equal(before.powerIncrease, 5);
  assert.equal(session.purchaseUpgrade('improved_reflector_density'), true);
  assert.equal(session.getPart('reflector1').baseTicks, 200);
  assert.equal(session.purchaseUpgrade('improved_neutron_reflection'), true);
  assert.equal(session.getPart('reflector1').powerIncrease, 5 * 1.01);
  assert.equal(session.purchaseUpgrade('laboratory'), true);
  assert.equal(session.purchaseUpgrade('full_spectrum_reflectors'), true);
  assert.equal(session.getPart('reflector1').powerIncrease, 5 * 1.01 + 5);
});

test('experimental fluid/fractal/ultracryonics compile into part catalog', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  session.systems.economy.addMoney(10_000_000);
  session.systems.economy.addExoticParticles(500);
  assert.equal(session.purchaseUpgrade('laboratory'), true);
  const vent0 = session.getPart('vent1');
  const cool0 = session.getPart('coolant_cell1');
  const ex0 = session.getPart('heat_exchanger1');
  assert.equal(session.purchaseUpgrade('fluid_hyperdynamics'), true);
  assert.equal(session.getPart('vent1').vent, vent0.vent * 2);
  assert.equal(session.getPart('heat_exchanger1').transfer, ex0.transfer * 2);
  assert.equal(session.getPart('vent1').containment, vent0.containment);
  assert.equal(session.purchaseUpgrade('fractal_piping'), true);
  assert.equal(session.getPart('vent1').containment, vent0.containment * 2);
  assert.equal(session.getPart('heat_exchanger1').containment, ex0.containment * 2);
  assert.equal(session.purchaseUpgrade('ultracryonics'), true);
  assert.equal(session.getPart('coolant_cell1').containment, cool0.containment * 2);
});

test('cell_power bakes into getPart basePower without double-applying coeffs', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  session.systems.economy.addMoney(10_000_000);
  const before = session.getPart('uranium1').basePower;
  assert.equal(session.purchaseUpgrade('uranium1_cell_power'), true);
  const after = session.getPart('uranium1');
  assert.equal(after.basePower, before * 2);
  const coeffs = resolveCellCoefficients(after.definition, { modifiers: session.modifiers });
  assert.equal(coeffs.power, after.basePower);
});

test('ceramic_composite plating reactorHeat stays unfloored', () => {
  const plate = buildIncrementalPlating(
    { id: 'reactor_plating1', title: 'P', reactorHeat: 250 },
    { platingHeatBonus: 0.05 },
  );
  assert.equal(plate.reactorHeat, 250 * 1.05);
  assert.equal(plate.heatAdjustment, 262.5);
});

test('resolveEpHeat matches host deriveEpHeat scale', () => {
  const base = 500_000_000;
  assert.equal(resolveEpHeat(base, { exoticParticles: 0 }), base);
  assert.equal(resolveEpHeat(base, { upgradeLevel: 1 }), base * 2);
  assert.equal(
    resolveEpHeat(base, { exoticParticles: 10_000_000, weaveQuantum: 1_000_000 }),
    base * (1 + Math.log10(10)),
  );
  assert.equal(
    resolveEpHeat(base, { catalystReduction: 0.05 }),
    base * 0.95,
  );
  assert.equal(
    resolveEpHeat(base, { catalystReduction: 0.9 }),
    base * 0.25,
  );
});

test('getPart PA epHeat applies IPA and live EP scale', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  session.systems.economy.addExoticParticles(10_000_000);
  const base = session.getPart('particle_accelerator1');
  assert.equal(base.baseEpHeat, 500_000_000);
  assert.equal(base.epHeat, 500_000_000 * (1 + Math.log10(10)));
  assert.equal(session.purchaseUpgrade('laboratory'), true);
  assert.equal(session.purchaseUpgrade('improved_particle_accelerators1'), true);
  session.systems.economy.addExoticParticles(201);
  const after = session.getPart('particle_accelerator1');
  assert.equal(after.epHeat, 500_000_000 * 2 * (1 + Math.log10(10)));
  assert.equal(session.resolveEpHeat('particle_accelerator1'), after.epHeat);
});

test('snapshot stats honor mechanicsOverrides.autoSellPercent', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  const maxPower = session.grid.maxPower || 0;
  const prestige = session.systems.economy.getPrestigeMultiplier();
  session.mechanicsOverrides = { ...session.mechanicsOverrides, autoSellPercent: 42 };
  assert.equal(session.getSnapshot().stats.cash, Math.floor(maxPower * 42 / 100) * prestige);
  session.mechanicsOverrides = { ...session.mechanicsOverrides, autoSellPercent: 10 };
  assert.equal(session.getSnapshot().stats.cash, Math.floor(maxPower * 10 / 100) * prestige);
});

test('prestige keeps EP upgrades and clears money upgrades', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  session.systems.economy.addMoney(10_000_000);
  session.systems.economy.addExoticParticles(500);
  assert.equal(session.purchaseUpgrade('improved_heat_vents'), true);
  assert.equal(session.purchaseUpgrade('laboratory'), true);
  assert.equal(session.systems.upgrades.getLevel('improved_heat_vents'), 1);
  assert.equal(session.systems.upgrades.getLevel('laboratory'), 1);
  session.prestige();
  assert.equal(session.systems.upgrades.getLevel('improved_heat_vents'), 0);
  assert.equal(session.systems.upgrades.getLevel('laboratory'), 1);
});

test('getPart bakes heat_power shop multiplier into power', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  session.systems.economy.addMoney(10_000_000);
  const cold = session.getPart('uranium1');
  assert.equal(cold.heatBoost, 1);
  assert.equal(cold.power, cold.basePower * (cold.cellMultiplier || 1));
  assert.equal(session.purchaseUpgrade('forceful_fusion'), true);
  session.grid.currentHeat = 1000;
  const hot = session.getPart('uranium1');
  const expectedBoost = heatPowerMultiplier(1, 1000);
  assert.equal(hot.heatBoost, expectedBoost);
  assert.equal(hot.power, hot.basePower * (hot.cellMultiplier || 1) * expectedBoost);
  const compiled = session.compilePartStats('uranium1');
  assert.equal(compiled.power, hot.power);
});

test('refreshCellOutputs covers every live cell before next tick', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  assert.equal(session.getCellOutputs().length, 0);
  assert.equal(session.placeComponent(0, 0, 'uranium1'), true);
  assert.equal(session.placeComponent(0, 1, 'uranium1'), true);
  const beforeTick = session.getCellOutputs();
  assert.equal(beforeTick.length, 2);
  assert.ok(session.getCellOutputAt(0, 0));
  assert.ok(session.getCellOutputAt(0, 1));
  assert.equal(beforeTick.every((o) => o.power > 0 && o.pulse >= 1), true);
  const projected = projectCellOutputs(session);
  assert.equal(projected.length, 2);
  session.tick();
  assert.equal(session.getCellOutputs().length, 2);
  session.removeComponent(0, 1);
  assert.equal(session.getCellOutputs().length, 1);
  assert.equal(session.getCellOutputAt(0, 1), null);
});

test('stats and objectives do not require inst.power or inst.heat', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  assert.equal(session.placeComponent(0, 0, 'uranium1'), true);
  const inst = session.grid.getComponentAt(0, 0);
  assert.equal(inst.power, undefined);
  assert.equal(inst.heat, undefined);
  const stats = deriveReactorStats(session.grid, session.modifiers, {
    mechanicsOverrides: session.mechanicsOverrides,
  });
  assert.ok(stats.power > 0);
  assert.ok(stats.cellPower > 0);
  session.tick();
  const progress = session.getObjectiveProgress();
  assert.equal(typeof progress.completed, 'boolean');
  assert.equal(typeof progress.percent, 'number');
});

test('session.getPipelineStages exposes revival stages', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  const stages = session.getPipelineStages();
  assert.ok(stages.includes('cells'));
  assert.ok(stages.includes('heat'));
  assert.ok(stages.includes('objectives'));
  assert.deepEqual(stages, session.ruleset.createPipeline().stages);
});

test('hasTickActivity detects live parts, autosell power, and pending intents', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  assert.equal(session.hasTickActivity(), false);
  assert.equal(session.placeComponent(0, 0, 'uranium1'), true);
  assert.equal(session.hasTickActivity(), true);
  session.removeComponent(0, 0);
  assert.equal(session.hasTickActivity(), false);
  session.toggles.auto_sell = true;
  session.grid.currentPower = 10;
  assert.equal(session.hasTickActivity(), true);
  session.grid.currentPower = 0;
  assert.equal(session.hasTickActivity(), false);
  session.dispatch({ type: 'VENT_HEAT', payload: {} });
  assert.equal(session.hasTickActivity(), true);
});

test('describeCellPulse returns structured neighbor pulse facts', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  assert.equal(session.placeComponent(0, 0, 'uranium1'), true);
  assert.equal(session.placeComponent(0, 1, 'reflector1'), true);
  assert.equal(session.placeComponent(1, 0, 'uranium1'), true);
  const desc = session.describeCellPulse(0, 0);
  assert.equal(desc.id, 'uranium1');
  assert.equal(desc.cellMultiplier, 1);
  assert.ok(desc.pulseN > 0);
  assert.equal(desc.pulse, desc.cellMultiplier + desc.pulseN);
  assert.ok(desc.neighbors.some((n) => n.kind === 'reflector' && n.contribution > 0));
  assert.ok(desc.neighbors.some((n) => n.kind === 'cell' && n.contribution > 0));
  assert.equal(describeCellPulse(session.grid, 0, 1), null);
});

test('economy intents own money mutations and emit economyChanged', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  const events = [];
  session.hooks.on('game:economyChanged', (payload) => events.push(payload));
  const baseMoney = toNumber(session.systems.economy.money);
  assert.equal(session.creditMoney(100), true);
  assert.equal(toNumber(session.systems.economy.money), baseMoney + 100);
  assert.equal(session.debitMoney(25), true);
  assert.equal(toNumber(session.systems.economy.money), baseMoney + 75);
  assert.equal(session.dispatch({ type: 'CREDIT_EP', payload: { amount: 7 } }), true);
  session.tick();
  assert.equal(toNumber(session.systems.economy.currentExoticParticles), 7);
  assert.ok(events.some((e) => e.reason === 'credit_money'));
  assert.ok(events.some((e) => e.reason === 'debit_money'));
  assert.ok(events.some((e) => e.reason === 'credit_ep'));
  session.loadEconomyState({ money: 50, currentExoticParticles: 1, totalExoticParticles: 1 });
  assert.equal(toNumber(session.systems.economy.money), 50);
  assert.ok(events.some((e) => e.reason === 'load'));
});

test('grantReward and GRANT_REWARD credit money/EP', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  const before = toNumber(session.systems.economy.money);
  assert.deepEqual(session.grantReward({ money: 10 }), {
    ok: true,
    money: 10,
    baseMoney: 10,
    ep: 0,
    prestigeMultiplier: 1,
    applyPrestige: false,
  });
  assert.equal(toNumber(session.systems.economy.money), before + 10);
  session.dispatch({ type: 'GRANT_REWARD', payload: { ep: 3 } });
  session.tick();
  assert.equal(toNumber(session.systems.economy.currentExoticParticles), 3);
});

test('creditMoney applyPrestige uses session prestige multiplier', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  session.systems.economy.addExoticParticles(1000);
  const mult = session.getPrestigeMultiplier();
  assert.ok(mult > 1);
  assert.equal(mult, session.systems.economy.getPrestigeMultiplier());
  const before = toNumber(session.systems.economy.money);
  assert.equal(session.creditMoney(100, { applyPrestige: true }), true);
  assert.equal(toNumber(session.systems.economy.money), before + (100 * mult));
  const mid = toNumber(session.systems.economy.money);
  const granted = session.grantReward({ money: 50, applyPrestige: true });
  assert.equal(granted.ok, true);
  assert.equal(granted.baseMoney, 50);
  assert.equal(granted.prestigeMultiplier, mult);
  assert.equal(granted.money, 50 * mult);
  assert.equal(toNumber(session.systems.economy.money), mid + (50 * mult));
  assert.equal(session.creditMoney(10), true);
  assert.equal(toNumber(session.systems.economy.money), mid + (50 * mult) + 10);
});

test('objective completion grants reward via session economy', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  const before = toNumber(session.systems.economy.money);
  assert.equal(session.placeComponent(0, 0, 'uranium1'), true);
  assert.equal(session.checkObjective(), true);
  assert.equal(toNumber(session.systems.economy.money), before + 10);
});

test('listUpgrades is sufficient sole UI source for levels/costs', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  session.systems.economy.addMoney(1_000_000);
  const catalog = session.listUpgrades();
  const vents = catalog.find((u) => u.id === 'improved_heat_vents');
  assert.ok(vents);
  assert.equal(vents.level, 0);
  assert.equal(vents.nextLevel, 1);
  assert.ok(vents.cost > 0);
  assert.ok(vents.baseCost > 0);
  assert.ok(Array.isArray(vents.classList));
  assert.equal(session.getUpgradeLevel('improved_heat_vents'), 0);
  assert.equal(session.purchaseUpgrade('improved_heat_vents'), true);
  assert.equal(session.getUpgradeLevel('improved_heat_vents'), 1);
  assert.equal(session.listUpgrades().find((u) => u.id === 'improved_heat_vents').level, 1);
  session.setUpgradeLevels([{ id: 'improved_heat_vents', level: 2 }]);
  assert.equal(session.getUpgradeLevel('improved_heat_vents'), 2);
});

test('session command queue accepts host action shape and drains immediately', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  session.systems.economy.addMoney(1_000_000);
  assert.equal(session.enqueueIntent({
    action: 'PLACE_PART',
    payload: { row: 0, col: 0, partId: 'uranium1', paid: true },
  }), true);
  assert.equal(session.pendingCommands, 1);
  assert.equal(session.peekCommands()[0].type, 'PLACE_PART');
  assert.equal(session.peekCommands()[0].payload.id, 'uranium1');
  const applied = session.drainCommands();
  assert.equal(applied.length, 1);
  assert.equal(applied[0].result.ok, true);
  assert.ok(session.grid.getComponentAt(0, 0));
  const ran = session.runCommand({ type: 'SELL_PART', payload: { row: 0, col: 0 } });
  assert.equal(ran.ok, true);
  assert.equal(session.grid.getComponentAt(0, 0), null);
  assert.equal(session.pendingCommands, 0);
});

test('placedCounts increment/rebuild own UnlockManager counters', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  session.systems.economy.addMoney(1_000_000);
  assert.equal(session.getPlacedCount('uranium', 1), 0);
  assert.equal(session.placeComponent(0, 0, 'uranium1'), true);
  assert.equal(session.getPlacedCount('uranium', 1), 0);
  session.runCommand({ type: 'PLACE_PART_PAID', payload: { row: 0, col: 1, id: 'uranium1' } });
  assert.equal(session.getPlacedCount('uranium', 1), 1);
  session.incrementPlacedCount('uranium', 1);
  assert.equal(session.getPlacedCount('uranium', 1), 2);
  const rebuilt = session.rebuildPlacedCounts();
  assert.equal(rebuilt['uranium:1'], 2);
  assert.equal(session.getPlacedCount('uranium', 1), 2);
  session.reboot({ keepEp: true });
  assert.equal(session.getPlacedCount('uranium', 1), 0);
});

test('getActiveParts classifies grid components by category', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  assert.equal(session.placeComponent(0, 0, 'uranium1'), true);
  assert.equal(session.placeComponent(0, 1, 'vent1'), true);
  assert.equal(session.placeComponent(1, 0, 'heat_exchanger1'), true);
  assert.equal(session.placeComponent(1, 1, 'capacitor1'), true);
  const parts = session.getActiveParts();
  assert.equal(parts.active_cells.length, 1);
  assert.equal(parts.active_cells[0].id, 'uranium1');
  assert.equal(parts.cells, parts.active_cells);
  assert.ok(parts.active_vents.some((p) => p.id === 'vent1'));
  assert.ok(parts.active_exchangers.some((p) => p.id === 'heat_exchanger1'));
  assert.ok(parts.active_capacitors.some((p) => p.id === 'capacitor1'));
  assert.ok(parts.active_vessels.length >= 2);
  assert.equal(session.classifyActivePart(0, 0).cells, true);
  assert.equal(session.getActivePartList('active_vents').length, 1);
});

test('queryNeighbors returns containment/cell/reflector tooltip buckets', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  assert.equal(session.placeComponent(1, 1, 'vent1'), true);
  assert.equal(session.placeComponent(1, 2, 'capacitor1'), true);
  assert.equal(session.placeComponent(1, 0, 'uranium1'), true);
  assert.equal(session.placeComponent(0, 1, 'reflector1'), true);
  assert.equal(session.placeComponent(2, 1, 'heat_exchanger1'), true);
  const neighbors = session.queryNeighbors(1, 1);
  assert.ok(neighbors.containment.some((n) => n.id === 'capacitor1'));
  assert.ok(neighbors.containment.some((n) => n.id === 'heat_exchanger1'));
  assert.ok(neighbors.cell.some((n) => n.id === 'uranium1'));
  assert.ok(neighbors.reflector.some((n) => n.id === 'reflector1'));
  assert.equal(session.countNeighborCategoryLevels(1, 1, 'capacitor'), 1);
  assert.deepEqual(session.queryNeighbors(5, 5), { containment: [], cell: [], reflector: [] });
});

test('listUpgrades ships operator displayTitle for host UI', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  const catalog = session.listUpgrades();
  const sell = catalog.find((u) => u.id === 'auto_sell_operator');
  const buy = catalog.find((u) => u.id === 'auto_buy_operator');
  assert.equal(sell.title, 'Auto-Sell Operator');
  assert.equal(sell.displayTitle, 'Power Grid Sync');
  assert.equal(buy.title, 'Auto-Buy Operator');
  assert.equal(buy.displayTitle, 'Supply Chain Logistics');
  const vents = catalog.find((u) => u.id === 'improved_heat_vents');
  assert.equal(vents.displayTitle, vents.title);
});

test('compiled valve transfer bakes transferMultiplier', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  const overflow = session.getPart('overflow_valve');
  assert.equal(overflow.transferMultiplier, 2.5);
  assert.equal(overflow.transfer, 1000 * 2.5);
  assert.equal(overflow.definition.transfer, 2500);
  assert.equal(overflow.definition.baseTransfer, 1000);
  const check = session.getPart('check_valve');
  assert.equal(check.transfer, 1200 * 2.5);
});

test('compiled reflector exposes neighborPulseValue', async () => {
  const session = await createGameSession({ gameId: 'reactor_revival' });
  const reflector = session.getPart('reflector1');
  assert.equal(
    reflector.neighborPulseValue,
    Math.max(0, 1 + (reflector.powerIncrease || 0) / 100),
  );
  assert.equal(reflector.definition.neighborPulseValue, reflector.neighborPulseValue);
  session.systems.economy.addMoney(1_000_000);
  assert.equal(session.purchaseUpgrade('improved_neutron_reflection'), true);
  const next = session.getPart('reflector1');
  assert.equal(next.neighborPulseValue, Math.max(0, 1 + (next.powerIncrease || 0) / 100));
  assert.ok(next.neighborPulseValue > reflector.neighborPulseValue);
});

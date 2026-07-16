import { createPipeline } from '../kernel/createPipeline.js';
import { createPhaseRunners } from './createPhaseRunners.js';
import { hashGridState } from '../kernel/hashState.js';
import { preTick } from './createInstance.js';
import { copyHeatFlowVectors } from './heat/heatPipeline.js';

export function copyCellOutputs(outputs = []) {
  if (!outputs.length) return Object.freeze([]);
  return Object.freeze(outputs.map((o) => Object.freeze({
    row: o.row,
    col: o.col,
    power: o.power,
    heat: o.heat,
    pulseN: o.pulseN,
    pulse: o.pulse,
    reflectorCount: o.reflectorCount,
    heatBoost: o.heatBoost,
  })));
}
export function createTickEngine(grid, manifest, hooks, systems = {}, options = {}) {
  const features = manifest.features;
  const runners = options.customRunners || createPhaseRunners(features);
  let legacyLoopOrder = features.legacyLoopOrder;
  let tickCount = 0;
  let meltdown = false;
  let allFuelRodsDepleted = false;
  let active = true;
  let currentEnvironment = null;
  let lastResult = null;

  const defaultStages = features.generatesMoney
    ? ['preTick', 'generateHeat', 'destroy', 'economy', 'meltdown']
    : ['preTick', 'environment', 'generateHeat', 'destroy', 'enrich', 'meltdown'];

  let pipeline = null;

  function buildCtx(overrides = {}) {
    return {
      grid,
      manifest,
      features: { ...features, legacyLoopOrder },
      hooks,
      economy: systems.economy || null,
      upgrades: systems.upgrades || null,
      automation: systems.automation || null,
      failure: systems.failure || null,
      objectives: systems.objectives || null,
      achievements: systems.achievements || null,
      stats: systems.stats || null,
      tickCount,
      multiplier: overrides.multiplier ?? 1,
      registry: overrides.registry || null,
      commands: overrides.commands || null,
      session: overrides.session || null,
      events: overrides.events || null,
      active,
      environment: currentEnvironment,
      meltdown,
      result: {
        euOutput: 0,
        powerOutput: 0,
        heatOutput: 0,
        ventedHeat: 0,
        meltdown: false,
        hullHeat: 0,
        destroyedComponents: [],
        enrichedCells: [],
        cellOutputs: [],
        heatTransfers: [],
        heatFlowVectors: Object.freeze([]),
        failureState: systems.failure?.failureState,
        hullIntegrity: systems.failure?.hullIntegrity,
        hasMeltedDown: systems.failure?.hasMeltedDown,
        gracePeriodTicks: systems.failure?.gracePeriodTicks,
      },
    };
  }

  function setPipeline(stages) {
    pipeline = createPipeline(stages, runners);
  }

  setPipeline(defaultStages);

  const engine = {
    get tickCount() { return tickCount; },
    get meltdown() { return meltdown; },
    get allFuelRodsDepleted() { return allFuelRodsDepleted; },

    setPipeline,
    setLoopOrder: (legacy) => { legacyLoopOrder = !!legacy; },
    setActive: (value) => { active = value; },
    setEnvironment: (env) => { currentEnvironment = env; },

    tick(overrides = {}) {
      if (meltdown) return engine.getLastResult();
      if (overrides.environment) currentEnvironment = overrides.environment;

      const ctx = buildCtx(overrides);
      hooks.emit('tick:before', ctx);
      pipeline.run(ctx);

      allFuelRodsDepleted = true;
      grid.forEach((_, __, inst) => {
        if (inst && inst.definition.rodCount > 0 && !inst.pendingDestruction) {
          const broken = inst.currentDamage >= inst.definition.maxDamage;
          if (!broken) allFuelRodsDepleted = false;
        }
      });

      ctx.result.euOutput = grid.euOutput;
      ctx.result.powerOutput = grid.powerOutput;
      ctx.result.ventedHeat = grid.ventedHeat;
      ctx.result.hullHeat = grid.currentHeat;
      meltdown = ctx.result.meltdown;
      tickCount++;
      lastResult = ctx.result;
      hooks.emit('tick:after', ctx);
      return ctx.result;
    },

    getLastResult() {
      if (lastResult) return lastResult;
      const failure = systems.failure;
      return {
        euOutput: grid.euOutput,
        powerOutput: grid.powerOutput,
        heatOutput: 0,
        ventedHeat: grid.ventedHeat,
        meltdown,
        hullHeat: grid.currentHeat,
        destroyedComponents: [],
        enrichedCells: [],
        failureState: failure?.failureState,
        hullIntegrity: failure?.hullIntegrity,
        hasMeltedDown: failure?.hasMeltedDown,
        gracePeriodTicks: failure?.gracePeriodTicks,
        cellOutputs: [],
        heatTransfers: [],
        heatFlowVectors: Object.freeze([]),
      };
    },

    getLastHeatFlowVectors() {
      return copyHeatFlowVectors(lastResult?.heatFlowVectors);
    },

    getLastCellOutputs() {
      return copyCellOutputs(lastResult?.cellOutputs);
    },

    simulateCycle(options = {}) {
      const maxTicks = options.maxTicks || 5000000;
      const results = {
        totalTicks: 0, totalEU: 0, totalPower: 0, totalHeat: 0, totalVentedHeat: 0,
        meltdown: false, meltdownTick: null, allDepleted: false,
      };
      meltdown = false;
      tickCount = 0;

      while (tickCount < maxTicks && !meltdown) {
        const tickResult = engine.tick();
        results.totalEU += tickResult.euOutput;
        results.totalPower += tickResult.powerOutput;
        results.totalHeat += tickResult.heatOutput;
        results.totalVentedHeat += tickResult.ventedHeat;
        if (tickResult.meltdown) {
          results.meltdown = true;
          results.meltdownTick = tickCount;
          break;
        }
        if (allFuelRodsDepleted) {
          results.allDepleted = true;
          break;
        }
      }
      results.totalTicks = tickCount;
      return results;
    },

    processTicks(n) {
      const results = { totalTicks: 0, totalEU: 0, totalPower: 0, totalHeat: 0, meltdown: false };
      for (let i = 0; i < n && !meltdown; i++) {
        const tickResult = engine.tick();
        results.totalEU += tickResult.euOutput;
        results.totalPower += tickResult.powerOutput;
        results.totalHeat += tickResult.heatOutput;
        if (tickResult.meltdown) results.meltdown = true;
      }
      results.totalTicks = n;
      return results;
    },

    findEquilibrium(maxTicks = 500000) {
      const seen = new Map();
      for (let i = 0; i < maxTicks && !meltdown; i++) {
        const hash = hashGridState(grid);
        if (seen.has(hash)) {
          return { found: true, cycleLength: i - seen.get(hash), ticks: i };
        }
        seen.set(hash, i);
        engine.tick();
      }
      return { found: false, cycleLength: 0, ticks: tickCount };
    },

    reset: () => {
      tickCount = 0;
      meltdown = false;
      allFuelRodsDepleted = false;
      lastResult = null;
      grid.resetHeat();
      grid.resetPower();
    },
  };

  return engine;
}

export function createHeadlessRunner(engine, options = {}) {
  const tickRate = options.tickRate || 50;
  let intervalId = null;
  let running = false;

  return {
    start() {
      if (running) return;
      running = true;
      intervalId = setInterval(() => {
        const result = engine.tick();
        if (options.onTick) options.onTick(result);
        if (result.meltdown || engine.allFuelRodsDepleted) {
          this.stop('meltdown');
        }
      }, tickRate);
    },

    stop(reason = 'manual') {
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
      running = false;
      if (options.onStop) options.onStop(reason);
    },

    runTicks(n) {
      const results = [];
      for (let i = 0; i < n; i++) {
        const result = engine.tick();
        results.push(result);
        if (result.meltdown) break;
      }
      return results;
    },

    get running() { return running; },
  };
}

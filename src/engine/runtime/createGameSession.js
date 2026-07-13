import { fetchGameManifest, loadGameManifest as loadGameManifestFromFs } from './loadGameManifest.js';
import { createRegistry } from '../kernel/createRegistry.js';
import { createHookBus } from '../kernel/createHookBus.js';
import { createReactorGrid } from '../reactor/createReactorGrid.js';
import { createTickEngine } from '../reactor/createTickEngine.js';
import { createInstance } from '../reactor/createInstance.js';
import { buildDefinitionsFromManifest } from '../reactor/behaviors/index.js';
import { createCodecs, serializeSession, deserializeSession } from '../systems/codecs.js';
import { createCommandBus, registerCommand } from '../systems/commands.js';
import { createEventQueue } from '../systems/events.js';
import { createOffline } from '../systems/automation.js';

const RULESET_MODULES = {
  ic2_reactor_planner_v3: () => import('../../games/ic2_reactor_planner_v3/ruleset.js'),
  ic2_exp_reactor_planner: () => import('../../games/ic2_exp_reactor_planner/ruleset.js'),
  reactor_incremental: () => import('../../games/reactor_incremental/ruleset.js'),
  reactor_knockoff: () => import('../../games/reactor_knockoff/ruleset.js'),
  reactor_revival: () => import('../../games/reactor_revival/ruleset.js'),
};

const isNodeRuntime = typeof process !== 'undefined' && !!process.versions?.node;

async function loadManifestFromFs(gameId) {
  return loadGameManifestFromFs(gameId);
}

async function loadManifest(gameId) {
  if (typeof window !== 'undefined') {
    const paths = [
      `/lib/reactor-core/games/${gameId}`,
      new URL(`../../games/${gameId}`, import.meta.url).href.replace(/\/$/, ''),
    ];
    for (const baseUrl of paths) {
      try {
        if (baseUrl.startsWith('/')) {
          return await fetchGameManifest(gameId, baseUrl);
        }
        const response = await fetch(`${baseUrl}/data.json`);
        if (response.ok) return await fetchGameManifest(gameId, baseUrl);
      } catch {
        continue;
      }
    }
    if (!isNodeRuntime) throw new Error(`Failed to load manifest for ${gameId}`);
  }
  return loadManifestFromFs(gameId);
}

export async function createGameLoader(gameId) {
  if (!RULESET_MODULES[gameId]) throw new Error(`Unknown game: ${gameId}`);
  const manifest = await loadManifest(gameId);
  const rulesetModule = await RULESET_MODULES[gameId]();
  const ruleset = rulesetModule.createRuleset({ manifest });
  return { manifest, ruleset };
}

function registerDefaultCommands() {
  registerCommand('PLACE_PART', (session, { row, col, id }) => session.placeComponent(row, col, id));
  registerCommand('REMOVE_PART', (session, { row, col }) => { session.removeComponent(row, col); return true; });
  registerCommand('PURCHASE_UPGRADE', (session, { id }) => session.purchaseUpgrade(id));
  registerCommand('SELL_POWER', (session) => {
    const sold = session.grid.currentPower;
    if (sold <= 0) return false;
    session.grid.currentPower = 0;
    session.systems.economy?.addMoney(sold);
    session.events?.emit('sellPower', { amount: sold });
    return sold;
  });
  registerCommand('VENT_HEAT', (session) => {
    const vented = session.grid.currentHeat;
    if (vented <= 0) return false;
    session.grid.currentHeat = 0;
    session.events?.emit('ventHeat', { amount: vented });
    return vented;
  });
  registerCommand('SET_TOGGLE', (session, { toggleName, value }) => {
    if (!session.toggles) session.toggles = {};
    session.toggles[toggleName] = value;
    if (toggleName === 'pause') session.setPaused(value);
    session.events?.emit('toggle', { toggleName, value });
    return true;
  });
  registerCommand('PAUSE_TOGGLE', (session) => {
    session.setPaused(!session.paused);
    if (!session.toggles) session.toggles = {};
    session.toggles.pause = session.paused;
    return session.paused;
  });
  registerCommand('REBOOT', (session, payload) => session.reboot(payload));
  registerCommand('SELL_PART', (session, { row, col }) => {
    const inst = session.grid.getComponentAt(row, col);
    if (!inst) return false;
    const def = inst.definition;
    const sellValue = Math.floor((def.baseCost || 0) * (def.level || 1) * 0.5);
    session.removeComponent(row, col);
    if (sellValue > 0) session.systems.economy?.addMoney(sellValue);
    session.events?.emit('partSold', { row, col, value: sellValue });
    return sellValue;
  });
  registerCommand('DEBIT_MONEY', (session, { amount }) => {
    if (!session.systems.economy) return false;
    return session.systems.economy.spendMoney(amount);
  });
  registerCommand('CREDIT_MONEY', (session, { amount }) => {
    if (!session.systems.economy) return false;
    session.systems.economy.addMoney(amount);
    return true;
  });
  registerCommand('DEBIT_LAYOUT_COST', (session, { money = 0, ep = 0 }) => {
    const economy = session.systems.economy;
    if (!economy) return false;
    if (money > 0 && !economy.spendMoney(money)) return false;
    if (ep > 0 && !economy.spendExoticParticles?.(ep)) return false;
    return true;
  });
}

let commandsRegistered = false;

export async function createGameSession({ gameId, manifest: providedManifest, ruleset: providedRuleset } = {}) {
  if (!commandsRegistered) {
    registerDefaultCommands();
    commandsRegistered = true;
  }

  let manifest = providedManifest;
  let ruleset = providedRuleset;

  if (!manifest || !ruleset) {
    const loaded = await createGameLoader(gameId);
    manifest = loaded.manifest;
    ruleset = loaded.ruleset;
  }

  ruleset.registerCommands?.(registerCommand);

  const hooks = createHookBus();
  const registry = createRegistry(createInstance);
  const grid = createReactorGrid(manifest);
  const codecs = createCodecs(manifest);
  const commands = createCommandBus();
  const events = createEventQueue(hooks);
  const saveCodec = ruleset.createSaveCodec?.() ?? null;
  const offlineSystem = ruleset.createOffline?.() ?? createOffline(manifest);

  const systems = ruleset.createSystems({ manifest, hooks });
  let modifiers = systems.upgrades?.compileModifiers(grid) || {};

  function recompileModifiers() {
    modifiers = systems.upgrades?.compileModifiers(grid) || {};
    const definitions = buildDefinitionsFromManifest(manifest, modifiers);
    registry.registerAll(definitions);
    grid.recalculateCaps();
  }

  const definitions = buildDefinitionsFromManifest(manifest, modifiers);
  registry.registerAll(definitions);

  const customRunners = ruleset.createPhaseRunners?.(manifest);
  const engine = createTickEngine(grid, manifest, hooks, systems, { customRunners, ruleset });

  if (ruleset.createPipeline) {
    const pipeline = ruleset.createPipeline();
    engine.setPipeline(pipeline.stages);
    if (pipeline.loopOrder) engine.setLoopOrder(pipeline.loopOrder === 'legacy');
  }

  let paused = false;
  let isCatchingUp = false;
  const toggles = { pause: false, auto_sell: false, auto_buy: false, heat_control: false, time_flux: true };

  const session = {
    gameId: manifest.id,
    manifest,
    ruleset,
    grid,
    registry,
    engine,
    hooks,
    systems,
    codecs,
    commands,
    events,
    toggles,
    baseRows: manifest.gridDefaults.rows,
    baseCols: manifest.gridDefaults.cols,
    runId: null,
    techTree: 'unified',
    achievements: [],
    totalPlayedTime: 0,
    lastSaveTime: Date.now(),
    placedCounts: {},
    blueprintPlanner: { slots: {}, active: false },
    get paused() { return paused; },
    get modifiers() { return modifiers; },
    get isCatchingUp() { return isCatchingUp; },
    set isCatchingUp(v) { isCatchingUp = !!v; },

    setPaused(value) { paused = !!value; toggles.pause = paused; },

    dispatch(command) {
      return commands.enqueue(command);
    },

    drainEvents() {
      return events.drain();
    },

    recompileModifiers,

    tick(options = {}) {
      if (paused || engine.meltdown) return engine.getLastResult();
      const multiplier = typeof options === 'number' ? options : (options.multiplier ?? 1);
      return engine.tick({ session, commands, registry, events, multiplier });
    },

    runTicks(n) {
      const results = [];
      for (let i = 0; i < n; i++) {
        const result = session.tick();
        results.push(result);
        if (result.meltdown) break;
      }
      return results;
    },

    runOffline(elapsedMs) {
      return offlineSystem.runOffline(session, elapsedMs);
    },

    purchaseUpgrade(id) {
      if (!systems.upgrades || !systems.economy) return false;
      const ok = systems.upgrades.purchase(id, systems.economy);
      if (ok) {
        recompileModifiers();
        events.emit('upgradePurchased', { id });
      }
      return ok;
    },

    reboot(options) {
      if (!systems.economy) return 0;
      const earned = systems.economy.reboot(options);
      grid.clearGrid();
      grid.resetHeat();
      grid.resetPower();
      engine.reset();
      recompileModifiers();
      ruleset.onPrestige?.(session, options);
      events.emit('reboot', { earned, options });
      return earned;
    },

    placeComponent(row, col, id) {
      const inst = registry.create(id);
      if (!inst) return false;
      grid.setComponentAt(row, col, inst);
      events.emit('partPlaced', { row, col, id });
      return true;
    },

    removeComponent(row, col) {
      grid.setComponentAt(row, col, null);
      events.emit('partRemoved', { row, col });
    },

    importDesign(code) {
      return codecs.importDesign(code, registry, grid);
    },

    exportDesign(format = 'json') {
      if (format === 'talonius') return codecs.exportTalonius(grid);
      if (format === 'mauvecloud') return codecs.exportMauveCloud(grid);
      return codecs.exportJson(grid);
    },

    save() {
      if (saveCodec) return saveCodec.serialize(session);
      return serializeSession(session);
    },

    load(data) {
      if (saveCodec) {
        saveCodec.load(session, data);
      } else {
        deserializeSession(session, data);
      }
      session.setPaused(data?.meta?.paused ?? data?.pause ?? data?.toggles?.pause ?? false);
      recompileModifiers();
    },

    loadLegacySave(data) {
      if (saveCodec?.decodeLegacy) {
        saveCodec.decodeLegacy(session, data);
      } else {
        throw new Error('Legacy save decoding is not supported for this game');
      }
      recompileModifiers();
    },

    getSnapshot() {
      const snapshot = {
        grid: grid.getSnapshot(),
        economy: systems.economy?.serialize(),
        upgrades: systems.upgrades?.serialize(),
        failure: systems.failure?.serialize?.(),
        objectives: systems.objectives?.serialize?.(),
        achievements: systems.achievements?.serialize?.() ?? [...session.achievements],
        stats: manifest.features?.objectives || manifest.features?.achievements
          ? systems.stats?.compute?.({
            grid,
            modifiers,
            upgrades: systems.upgrades,
            economy: systems.economy,
            mechanicsOverrides: session.mechanicsOverrides,
          })
          : undefined,
        engine: { tickCount: engine.tickCount, meltdown: engine.meltdown },
        toggles: { ...toggles },
        techTree: session.techTree,
        totalPlayedTime: session.totalPlayedTime,
        lastSaveTime: session.lastSaveTime,
        placedCounts: { ...session.placedCounts },
        isCatchingUp,
        paused,
      };
      return ruleset.extendSnapshot?.(session, snapshot) ?? snapshot;
    },

    simulateCycle(options) {
      return engine.simulateCycle(options);
    },

    simulateGenerationCooldown(options) {
      return ruleset.simulateGenerationCooldown?.(session, options);
    },
  };

  ruleset.onSessionInit?.({
    grid, registry, engine, hooks, systems, manifest, codecs, session,
  });

  return session;
}

export { createHeadlessRunner } from '../reactor/createTickEngine.js';
export { createHistoryManager } from '../reactor/createReactorGrid.js';

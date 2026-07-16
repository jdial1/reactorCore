import { fetchGameManifest, loadGameManifest as loadGameManifestFromFs } from './loadGameManifest.js';
import { createRegistry } from '../kernel/createRegistry.js';
import { createHookBus } from '../kernel/createHookBus.js';
import { createReactorGrid } from '../reactor/createReactorGrid.js';
import { createTickEngine } from '../reactor/createTickEngine.js';
import { createInstance } from '../reactor/createInstance.js';
import { buildDefinitionsFromManifest } from '../reactor/behaviors/index.js';
import { createCodecs, serializeSession, deserializeSession } from '../systems/codecs.js';
import { createCommandBus, registerCommand, normalizeCommand } from '../systems/commands.js';
import { createEventQueue } from '../systems/events.js';
import { createOffline } from '../systems/automation.js';
import { toNumber } from '../systems/decimal.js';
import { compileMechanicsOverrides, CORE_MECHANICS_OVERRIDE_KEYS } from '../systems/mechanicsPolicy.js';
import { buildContainmentSegments, getHeatSegmentAt } from '../reactor/heat/containmentSegments.js';
import { getTileFlowDiagnostics } from '../reactor/heat/heatFlowDiagnostics.js';
import { deriveReactorStats } from '../systems/reactorStats.js';
import {
  computeAbsoluteLayoutCost,
  filterAffordablePlacements,
  previewPartialBlueprint,
  computeBlueprintCostBreakdown,
  computeGridSellCredit,
  computeInstanceSellValue,
  partCostForCell,
} from '../systems/blueprint.js';
import { projectModifiersForHost } from '../systems/modifierProjection.js';
import { isValidGridCoord } from '../kernel/gridUtils.js';
import { listCompiledParts, getCompiledPart, compilePartStats } from '../systems/partCatalog.js';
import { getPartDescription } from '../systems/partDescription.js';
import { resolvePartDisplayRates, resolveDisplayRates } from '../reactor/heat/effectiveRates.js';
import { previewPrestige, calculateWeaveEp } from '../systems/prestige.js';
import { resolveEpHeat } from '../systems/epHeat.js';
import { partAutoReplaceCost } from '../systems/mechanicsPolicy.js';
import {
  getPlacedCount as readPlacedCount,
  incrementPlacedCount as bumpPlacedCount,
  rebuildPlacedCountsFromGrid,
  clearPlacedCounts,
} from '../systems/placedCounts.js';
import { deriveActiveParts, getActivePartList, classifyActivePart } from '../systems/activeParts.js';
import { runBatchTicks } from './runBatchTicks.js';
import { projectCellOutputs, describeCellPulse } from '../reactor/phases/cellPhase.js';

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

function notePlacementCount(session, id) {
  const def = session.registry?.get?.(id)
    || session.manifest?.components?.find((component) => component.id === id);
  if (!def?.type) return;
  session.incrementPlacedCount?.(def.type, def.level ?? 1);
}

function registerDefaultCommands() {
  registerCommand('PLACE_PART', (session, payload = {}) => {
    const { row, col, id, paid = false, policy } = payload;
    if (paid) {
      const result = session.placeComponentPaid(row, col, id, policy);
      if (result?.ok) notePlacementCount(session, id);
      return result;
    }
    const placed = session.placeComponent(row, col, id);
    if (placed) notePlacementCount(session, id);
    return placed;
  });
  registerCommand('PLACE_PART_PAID', (session, { row, col, id, policy } = {}) => {
    const result = session.placeComponentPaid(row, col, id, policy);
    if (result?.ok) notePlacementCount(session, id);
    return result;
  });
  registerCommand('REMOVE_PART', (session, { row, col }) => { session.removeComponent(row, col); return true; });
  registerCommand('PURCHASE_UPGRADE', (session, { id }) => session.purchaseUpgrade(id));
  registerCommand('SELL_POWER', (session) => {
    const sold = session.grid.currentPower;
    if (sold <= 0) return false;
    session.grid.currentPower = 0;
    const overrides = session.mechanicsOverrides || {};
    const sellPriceMultiplier = toNumber(overrides.sellPriceMultiplier) || 1;
    const economy = session.systems.economy;
    const prestige = economy?.getPrestigeMultiplier?.() ?? 1;
    const income = sold * prestige * sellPriceMultiplier;
    if (income > 0) session.creditMoney?.(income) ?? economy?.addMoney(income);
    economy?.recordManualPowerSold?.(sold);
    session.events?.emit('sellPower', { amount: sold });
    return sold;
  });
  registerCommand('VENT_HEAT', (session) => {
    const heat = session.grid.currentHeat;
    if (heat <= 0) return false;
    const modifiers = session.modifiers || {};
    const baseReduce = (session.manifest?.mechanics?.baseManualHeatReduce ?? 1)
      * (modifiers.manualVentMultiplier || 1);
    const reduction = baseReduce + (session.grid.maxHeat || 0) * (modifiers.manualVentPercent || 0);
    const amount = Math.min(heat, Math.max(0, reduction));
    if (amount <= 0) return false;
    const remaining = Math.max(0, heat - amount);
    session.grid.currentHeat = remaining <= 0.001 ? 0 : remaining;
    const finalRemaining = session.grid.currentHeat;
    session.events?.emit('ventHeat', { amount, remaining: finalRemaining });
    if (finalRemaining <= 0.001 && amount > 0) {
      session.systems.objectives?.setFlags?.({ soldHeat: true });
      session.events?.emit('soldHeat', { amount });
    }
    return amount;
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
  registerCommand('SELL_PART', (session, { row, col, policy } = {}) => {
    if (!isValidGridCoord(row, col, session.grid)) return false;
    const inst = session.grid.getComponentAt(row, col);
    if (!inst) return false;
    const sellValue = computeInstanceSellValue(inst, {
      row,
      col,
      grid: session.grid,
      session,
      computeSellValue: policy?.computeSellValue || session.sellValuePolicy,
    });
    session.removeComponent(row, col);
    if (sellValue > 0) {
      session.creditMoney?.(sellValue) ?? session.systems.economy?.addMoney(sellValue);
    }
    session.events?.emit('partSold', { row, col, value: sellValue });
    return sellValue;
  });
  registerCommand('DEBIT_MONEY', (session, { amount }) => session.debitMoney?.(amount) ?? false);
  registerCommand('CREDIT_MONEY', (session, { amount }) => session.creditMoney?.(amount) ?? false);
  registerCommand('DEBIT_EP', (session, { amount }) => session.debitExoticParticles?.(amount) ?? false);
  registerCommand('CREDIT_EP', (session, { amount }) => session.creditExoticParticles?.(amount) ?? false);
  registerCommand('GRANT_REWARD', (session, payload = {}) => session.grantReward?.(payload) ?? false);
  registerCommand('DEBIT_LAYOUT_COST', (session, { money = 0, ep = 0 }) => {
    if (money > 0 && session.debitMoney && !session.debitMoney(money)) return false;
    if (ep > 0 && session.debitExoticParticles && !session.debitExoticParticles(ep)) {
      if (money > 0) session.creditMoney?.(money);
      return false;
    }
    return true;
  });
}

const TICK_ACTIVITY_INTENTS = new Set(['SELL_POWER', 'VENT_HEAT', 'SELL_PART', 'GRANT_REWARD']);

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
  let modifiers = systems.upgrades?.compileModifiers() || {};
  let mechanicsOverrides = {};

  function syncMechanicsOverrides(mods) {
    const hostExtras = {};
    for (const [key, value] of Object.entries(mechanicsOverrides)) {
      if (!CORE_MECHANICS_OVERRIDE_KEYS.has(key)) hostExtras[key] = value;
    }
    mechanicsOverrides = {
      ...hostExtras,
      ...compileMechanicsOverrides(manifest, mods, {
        alteredMaxPower: grid.maxPower || 0,
      }),
    };
  }

  function refreshCellOutputs() {
    const outputs = projectCellOutputs(session);
    engine.setLastCellOutputs?.(outputs);
    return outputs;
  }

  function emitEconomyChanged(reason, extra = {}) {
    const economy = systems.economy;
    if (!economy) return;
    events.emit('economyChanged', {
      reason,
      money: toNumber(economy.money),
      currentExoticParticles: toNumber(economy.currentExoticParticles),
      totalExoticParticles: toNumber(economy.totalExoticParticles),
      ...extra,
    });
  }

  function hasLiveComponents() {
    let found = false;
    grid.forEach((_, __, inst) => {
      if (found || !inst || inst.pendingDestruction) return;
      found = true;
    });
    return found;
  }

  function hasTickActivity() {
    if (hasLiveComponents()) return true;
    const autoSell = !!(toggles.auto_sell || mechanicsOverrides.autoSellFromUpgrade);
    if (autoSell && (grid.currentPower || 0) > 0) return true;
    if (commands.hasPendingOfTypes?.(TICK_ACTIVITY_INTENTS)) return true;
    return false;
  }

  function recompileModifiers() {
    modifiers = systems.upgrades?.compileModifiers() || {};
    const definitions = buildDefinitionsFromManifest(manifest, modifiers);
    registry.registerAll(definitions);
    grid.forEach((_, __, inst) => {
      if (!inst?.definition?.id) return;
      const next = registry.get(inst.definition.id);
      if (next) inst.definition = next;
    });
    grid.recalculateCaps();
    syncMechanicsOverrides(modifiers);
    refreshCellOutputs();
  }

  const definitions = buildDefinitionsFromManifest(manifest, modifiers);
  registry.registerAll(definitions);
  grid.recalculateCaps();
  syncMechanicsOverrides(modifiers);

  const customRunners = ruleset.createPhaseRunners?.(manifest);
  const engine = createTickEngine(grid, manifest, hooks, systems, { customRunners, ruleset });

  if (ruleset.createPipeline) {
    const pipeline = ruleset.createPipeline();
    engine.setPipeline(pipeline.stages);
    if (pipeline.loopOrder) engine.setLoopOrder(pipeline.loopOrder === 'legacy');
  }

  let paused = false;
  let isCatchingUp = false;
  let lastHeatWarningLevel = null;
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
    get hostModifiers() { return projectModifiersForHost(modifiers); },
    get mechanicsOverrides() { return mechanicsOverrides; },
    set mechanicsOverrides(value) { mechanicsOverrides = value || {}; },
    get isCatchingUp() { return isCatchingUp; },
    set isCatchingUp(v) { isCatchingUp = !!v; },

    setPaused: (value) => { paused = !!value; toggles.pause = paused; },
    setCanPurchaseExtra: (fn) => systems.upgrades?.setCanPurchaseExtra?.(fn),
    previewUpgrade: (id) => systems.upgrades?.previewPurchase?.(id, systems.economy, session) ?? null,
    listUpgrades: () => systems.upgrades?.listDisplayCatalog?.(session) ?? [],
    listParts: () => listCompiledParts(session),
    getPart: (id) => getCompiledPart(session, id),
    getPartDescription: (id, opts = {}) => getPartDescription(session, id, opts),
    compilePartStats: (partId, options = {}) => compilePartStats(partId, {
      manifest,
      registry,
      modifiers: options.modifiers ?? modifiers,
      exoticParticles: options.exoticParticles ?? systems.economy?.currentExoticParticles,
      weaveQuantum: options.weaveQuantum
        ?? systems.economy?.weaveQuantum
        ?? manifest.economy?.weaveQuantum,
      currentHeat: options.currentHeat ?? grid.currentHeat,
      heatPowerMultiplier: options.heatPowerMultiplier
        ?? mechanicsOverrides.heatPowerMultiplier
        ?? modifiers.heatPowerMultiplier
        ?? 0,
      protiumParticles: options.protiumParticles ?? systems.economy?.protiumParticles ?? 0,
      ...options,
    }),
    getHeatSegmentAt: (row, col) => getHeatSegmentAt(grid, row, col, { modifiers }),
    getTileFlowDiagnostics: (row, col) => getTileFlowDiagnostics(grid, row, col, { modifiers }),
    getPipelineStages: () => engine.getPipelineStages?.()
      ?? (ruleset.createPipeline?.()?.stages ? [...ruleset.createPipeline().stages] : []),
    projectCellOutputs: () => projectCellOutputs(session),
    refreshCellOutputs,
    hasTickActivity,
    describeCellPulse: (row, col) => describeCellPulse(grid, row, col),
    debitMoney(amount) {
      if (!systems.economy) return false;
      const ok = systems.economy.spendMoney(amount);
      if (ok) emitEconomyChanged('debit_money', { amount: toNumber(amount) });
      return ok;
    },
    creditMoney(amount) {
      if (!systems.economy) return false;
      systems.economy.addMoney(amount);
      emitEconomyChanged('credit_money', { amount: toNumber(amount) });
      return true;
    },
    debitExoticParticles(amount) {
      if (!systems.economy?.spendExoticParticles) return false;
      const ok = systems.economy.spendExoticParticles(amount);
      if (ok) emitEconomyChanged('debit_ep', { amount: toNumber(amount) });
      return ok;
    },
    creditExoticParticles(amount) {
      if (!systems.economy?.addExoticParticles) return false;
      systems.economy.addExoticParticles(amount);
      emitEconomyChanged('credit_ep', { amount: toNumber(amount) });
      return true;
    },
    grantReward(payload = {}) {
      const moneyAmt = toNumber(
        payload.money != null ? payload.money
          : payload.reward != null ? payload.reward
            : 0,
      );
      const epAmt = toNumber(
        payload.ep != null ? payload.ep
          : payload.ep_reward != null ? payload.ep_reward
            : 0,
      );
      if (!(moneyAmt > 0) && !(epAmt > 0)) return false;
      if (moneyAmt > 0) session.creditMoney(moneyAmt);
      if (epAmt > 0) session.creditExoticParticles(epAmt);
      events.emit('rewardGranted', { money: moneyAmt, ep: epAmt });
      emitEconomyChanged('grant_reward', { money: moneyAmt, ep: epAmt });
      return { ok: true, money: moneyAmt, ep: epAmt };
    },
    getEconomySnapshot() {
      return systems.economy?.serialize?.() ?? null;
    },
    loadEconomyState(data) {
      systems.economy?.deserialize?.(data);
      emitEconomyChanged('load');
    },
    getUpgradeLevel: (id) => systems.upgrades?.getLevel?.(id) ?? 0,
    setUpgradeLevels(entries) {
      systems.upgrades?.deserialize?.(entries);
      recompileModifiers();
    },
    isUpgradeAvailable: (id) => systems.upgrades?.isAvailable?.(id, session) ?? false,
    getObjectiveProgress: (context = {}) => systems.objectives?.getCurrentProgress?.(session, context)
      ?? { completed: false, percent: 0, text: '' },
    checkObjective: (context = {}) => systems.objectives?.checkCurrent?.(session, context) ?? false,
    previewPartialBlueprint: (layout, options = {}, policy = {}) =>
      previewPartialBlueprint(session, layout, options, policy),
    filterAffordablePlacements: (placements, sellCredit = 0, policy = {}) =>
      filterAffordablePlacements(session, placements, sellCredit, policy),
    layoutCost: (layout, policy = {}) => computeAbsoluteLayoutCost(session, layout, policy),
    blueprintCostBreakdown: (layout, policy = {}) => computeBlueprintCostBreakdown(session, layout, policy),
    computeGridSellCredit: (sellMultiplier, options) => computeGridSellCredit(session, sellMultiplier, options),
    computeSellValue: (row, col) => {
      const inst = grid.getComponentAt(row, col);
      if (!inst) return 0;
      return computeInstanceSellValue(inst, {
        row,
        col,
        grid,
        session,
        computeSellValue: session.sellValuePolicy,
      });
    },
    resolveDisplayRates: (partIdOrInstOrDef) => {
      if (partIdOrInstOrDef?.definition && typeof partIdOrInstOrDef.ticks === 'number') {
        return resolveDisplayRates(partIdOrInstOrDef, grid, modifiers);
      }
      return resolvePartDisplayRates(partIdOrInstOrDef, session);
    },
    resolveEpHeat: (partIdOrDef) => {
      const part = typeof partIdOrDef === 'string'
        ? getCompiledPart(session, partIdOrDef)
        : partIdOrDef;
      if (!part) return 0;
      const base = part.baseEpHeat ?? part.epHeat ?? part.definition?.baseEpHeat ?? 0;
      return resolveEpHeat(base, {
        partLevel: part.level ?? part.definition?.level ?? 1,
        acceleratorEpHeatByLevel: modifiers.acceleratorEpHeatByLevel,
        catalystReduction: modifiers.catalystReduction || 0,
        exoticParticles: systems.economy?.currentExoticParticles,
        weaveQuantum: systems.economy?.weaveQuantum ?? manifest.economy?.weaveQuantum,
      });
    },
    previewPrestige: (options) => previewPrestige(session, options),
    calculatePrestigeReward: () => systems.economy?.calculatePrestigeReward?.()
      ?? calculateWeaveEp(
        systems.economy?.sessionPowerProduced,
        systems.economy?.sessionHeatDissipated,
        systems.economy?.weaveQuantum ?? manifest.economy?.weaveQuantum,
      ),
    partAutoReplaceCost: (partOrId) => {
      const def = typeof partOrId === 'string'
        ? registry.get(partOrId)
        : partOrId;
      return partAutoReplaceCost(def, mechanicsOverrides);
    },
    projectModifiers: () => projectModifiersForHost(modifiers),
    getHeatFlowVectors: () => engine.getLastHeatFlowVectors?.() ?? Object.freeze([]),
    getCellOutputs: () => engine.getLastCellOutputs?.() ?? Object.freeze([]),
    getCellOutputAt: (row, col) => {
      const outputs = engine.getLastCellOutputs?.() ?? [];
      return outputs.find((o) => o.row === row && o.col === col) || null;
    },
    dispatch: (command) => commands.enqueue(command),
    enqueueIntent: (intent) => commands.enqueue(intent),
    drainCommands: () => commands.drain(session),
    peekCommands: () => commands.peek(),
    clearCommands: () => { commands.clear(); },
    get pendingCommands() { return commands.pending; },
    runCommand(command) {
      const normalized = normalizeCommand(command);
      if (!normalized || !commands.enqueue(normalized)) {
        return { ok: false, result: null, applied: [] };
      }
      const applied = commands.drain(session);
      const entry = applied.find((item) => item.type === normalized.type) ?? applied[applied.length - 1];
      const result = entry?.result;
      const ok = result !== false && result != null && result?.ok !== false;
      return { ok, result: result ?? null, applied };
    },
    getPlacedCount: (type, level) => readPlacedCount(session.placedCounts, type, level),
    incrementPlacedCount(type, level, amount = 1) {
      session.placedCounts = bumpPlacedCount(session.placedCounts || {}, type, level, amount);
      return session.placedCounts[`${type}:${level ?? 1}`] || 0;
    },
    rebuildPlacedCounts() {
      session.placedCounts = rebuildPlacedCountsFromGrid(grid);
      return { ...session.placedCounts };
    },
    setPlacedCounts(counts = {}) {
      session.placedCounts = { ...(counts || {}) };
      return { ...session.placedCounts };
    },
    clearPlacedCounts() {
      clearPlacedCounts(session.placedCounts);
      return session.placedCounts;
    },
    getActiveParts: () => deriveActiveParts(grid),
    getActivePartList: (key) => getActivePartList(grid, key),
    classifyActivePart: (row, col) => {
      const inst = grid.getComponentAt(row, col);
      return classifyActivePart(inst, { row, col, grid });
    },
    drainEvents: () => events.drain(),
    recompileModifiers,
    sellValuePolicy: null,

    tick(options = {}) {
      if (paused || engine.meltdown) return engine.getLastResult();
      const multiplier = typeof options === 'number' ? options : (options.multiplier ?? 1);
      const result = engine.tick({ session, commands, registry, events, multiplier });
      const maxHeat = grid.maxHeat || 0;
      const heatRatio = maxHeat > 0 ? (grid.currentHeat || 0) / maxHeat : 0;
      const criticalHeatRatio = manifest.mechanics?.criticalHeatRatio ?? 0.85;
      const highHeatRatio = manifest.mechanics?.highHeatRatio ?? 0.7;
      let heatWarningLevel = null;
      if (heatRatio >= criticalHeatRatio) heatWarningLevel = 'critical';
      else if (heatRatio >= highHeatRatio) heatWarningLevel = 'high';
      result.heatRatio = heatRatio;
      result.heatWarningLevel = heatWarningLevel;
      if (heatWarningLevel !== lastHeatWarningLevel) {
        events.emit('heatWarning', { ratio: heatRatio, level: heatWarningLevel });
      }
      lastHeatWarningLevel = heatWarningLevel;
      return result;
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

    runOffline: (elapsedMs) => offlineSystem.runOffline(session, elapsedMs),

    async *catchupGenerator(totalTicks, chunkSize = 10000) {
      let remaining = Math.max(0, Math.floor(Number(totalTicks) || 0));
      const size = Math.max(1, Math.floor(Number(chunkSize) || 10000));
      let processed = 0;
      isCatchingUp = true;
      try {
        while (remaining > 0) {
          const batch = Math.min(size, remaining);
          runBatchTicks(session, batch, { collectEvents: false, drainEvents: false });
          processed += batch;
          remaining -= batch;
          yield { processed, remaining, ticksProcessed: processed };
          await Promise.resolve();
        }
      } finally {
        isCatchingUp = false;
      }
    },

    purchaseUpgrade(id) {
      if (!systems.upgrades || !systems.economy) return false;
      if (systems.failure?.hasMeltedDown || engine.meltdown) return false;
      const result = systems.upgrades.purchase(id, systems.economy, session);
      if (!result?.ok) return false;
      recompileModifiers();
      emitEconomyChanged('purchase_upgrade', { id, spent: result.spent });
      events.emit('upgradePurchased', {
        id,
        newLevel: result.newLevel,
        spent: result.spent,
      });
      return true;
    },

    reboot(options = {}) {
      if (!systems.economy) return 0;
      const refundEp = options.refundEp === true;
      const keepEp = options.keepEp != null ? !!options.keepEp : !refundEp;
      const resolved = { ...options, keepEp, refundEp };
      let activeCells = 0;
      grid.forEach((_, __, inst) => {
        if (inst?.definition?.category === 'cell' && inst.ticks > 0) activeCells++;
      });
      const prestigePayload = {
        keepEp,
        fuelCellCount: activeCells,
        sessionPowerProduced: toNumber(systems.economy.sessionPowerProduced),
        sessionHeatDissipated: toNumber(systems.economy.sessionHeatDissipated),
        earned: keepEp && !refundEp
          ? (systems.economy.calculatePrestigeReward?.() ?? 0)
          : 0,
        weaveQuantum: systems.economy.weaveQuantum ?? manifest.economy?.weaveQuantum ?? 1_000_000,
      };
      const earned = systems.economy.reboot(resolved);
      grid.clearGrid();
      grid.resetHeat();
      grid.resetPower();
      engine.reset();
      clearPlacedCounts(session.placedCounts);

      ruleset.onPrestige?.(session, resolved);
      recompileModifiers();
      events.emit('reboot', { earned, options: resolved, ...prestigePayload });
      if (keepEp && !refundEp) events.emit('prestigeCompleted', { ...prestigePayload, earned });
      return earned;
    },

    reset(options = {}) {
      return session.reboot(options);
    },

    prestige(options = {}) {
      return session.reboot({ keepEp: true, ...options, refundEp: false });
    },

    placeComponent(row, col, id) {
      if (!isValidGridCoord(row, col, grid)) return false;
      const inst = registry.create(id);
      if (!inst) return false;
      grid.setComponentAt(row, col, inst);
      grid.recalculateCaps();
      refreshCellOutputs();
      events.emit('partPlaced', { row, col, id });
      return true;
    },

    placeComponentPaid(row, col, id, policy = {}) {
      if (!isValidGridCoord(row, col, grid)) {
        return { ok: false, reason: 'bounds', id, row, col };
      }
      if (grid.getComponentAt(row, col)) {
        return { ok: false, reason: 'occupied', id, row, col };
      }
      const def = registry.get(id) || manifest.components?.find((component) => component.id === id);
      if (!def) return { ok: false, reason: 'unknown', id, row, col };
      const economy = systems.economy;
      if (!economy) return { ok: false, reason: 'no_economy', id, row, col };
      const cost = partCostForCell(def, { id, lvl: def.level || 1 }, policy);
      if (cost.ep > 0 && toNumber(economy.currentExoticParticles) < cost.ep) {
        return { ok: false, reason: 'funds', cost, id, row, col };
      }
      if (cost.money > 0 && toNumber(economy.money) < cost.money) {
        return { ok: false, reason: 'funds', cost, id, row, col };
      }
      if (cost.ep > 0 && !session.debitExoticParticles(cost.ep)) {
        return { ok: false, reason: 'funds', cost, id, row, col };
      }
      if (cost.money > 0 && !session.debitMoney(cost.money)) {
        if (cost.ep > 0) session.creditExoticParticles(cost.ep);
        return { ok: false, reason: 'funds', cost, id, row, col };
      }
      const placed = session.placeComponent(row, col, id);
      if (!placed) {
        if (cost.ep > 0) session.creditExoticParticles(cost.ep);
        if (cost.money > 0) session.creditMoney(cost.money);
        return { ok: false, reason: 'place_failed', cost, id, row, col };
      }
      events.emit('partPurchased', { row, col, id, cost });
      return { ok: true, cost, id, row, col };
    },

    removeComponent(row, col) {
      if (!isValidGridCoord(row, col, grid)) return;
      grid.setComponentAt(row, col, null);
      grid.recalculateCaps();
      refreshCellOutputs();
      events.emit('partRemoved', { row, col });
    },

    importDesign: (code) => codecs.importDesign(code, registry, grid),

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
      const failure = systems.failure?.serialize?.();
      const statsOptions = {
        autoSellPercent: mechanicsOverrides?.autoSellPercent
          ?? systems.upgrades?.getAutoSellPercent?.()
          ?? modifiers?.autoSellPercent
          ?? 0,
        prestigeMultiplier: systems.economy?.getPrestigeMultiplier?.() ?? 1,
        mechanicsOverrides: session.mechanicsOverrides,
        toggles,
        autoSellActive: toggles?.auto_sell || mechanicsOverrides?.autoSellFromUpgrade,
        protiumParticles: systems.economy?.protiumParticles ?? 0,
        criticalHeatRatio: manifest.mechanics?.criticalHeatRatio ?? 0.85,
        highHeatRatio: manifest.mechanics?.highHeatRatio ?? 0.7,
        baseManualHeatReduce: manifest.mechanics?.baseManualHeatReduce ?? 1,
        powerOverflowToHeatRatio: manifest.mechanics?.economy?.powerOverflowToHeatRatio ?? 1,
        includeManualVent: true,
      };
      const stats = systems.stats?.compute?.({
        grid,
        modifiers,
        upgrades: systems.upgrades,
        economy: systems.economy,
        mechanicsOverrides: session.mechanicsOverrides,
        toggles,
      }) ?? deriveReactorStats(grid, modifiers, statsOptions);
      const containmentSegments = buildContainmentSegments(grid, { modifiers });
      const cellOutputs = engine.getLastCellOutputs?.() ?? Object.freeze([]);
      const snapshot = {
        grid: grid.getSnapshot(),
        economy: systems.economy?.serialize(),
        upgrades: systems.upgrades?.serialize(),
        failure,
        failureState: failure?.failureState,
        hullIntegrity: failure?.hullIntegrity,
        hasMeltedDown: failure?.hasMeltedDown,
        gracePeriodTicks: failure?.gracePeriodTicks,
        objectives: systems.objectives?.serialize?.(),
        achievements: systems.achievements?.serialize?.() ?? [...session.achievements],
        stats,
        heatRatio: stats?.heatRatio ?? 0,
        heatWarningLevel: stats?.heatWarningLevel ?? null,
        powerNetChange: stats?.powerNetChange ?? 0,
        heatNetChange: stats?.heatNetChange ?? 0,
        containmentSegments,
        heatFlowVectors: engine.getLastHeatFlowVectors?.() ?? Object.freeze([]),
        cellOutputs,
        lastCellOutputs: cellOutputs,
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

    simulateCycle: (options) => engine.simulateCycle(options),
    simulateGenerationCooldown: (options) => ruleset.simulateGenerationCooldown?.(session, options),
  };

  ruleset.onSessionInit?.({
    grid, registry, engine, hooks, systems, manifest, codecs, session,
  });

  return session;
}

export { createHeadlessRunner } from '../reactor/createTickEngine.js';
export { createHistoryManager } from '../reactor/createReactorGrid.js';

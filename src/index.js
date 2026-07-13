export { createGameLoader, createGameSession, createHeadlessRunner, createHistoryManager } from './engine/runtime/createGameSession.js';
export { loadGameManifest, composeGameManifest } from './engine/runtime/loadGameManifest.js';
export { runBatchTicks } from './engine/runtime/runBatchTicks.js';
export { createRegistry } from './engine/kernel/createRegistry.js';
export { createHookBus } from './engine/kernel/createHookBus.js';
export { validateManifest, assertCapability } from './engine/kernel/validateManifest.js';
export { createReactorGrid } from './engine/reactor/createReactorGrid.js';
export { createTickEngine } from './engine/reactor/createTickEngine.js';
export { buildBehavior, buildDefinitionsFromManifest } from './engine/reactor/behaviors/index.js';
export { createInstance, cloneInstance, preTick, isBroken } from './engine/reactor/createInstance.js';
export { createEconomy } from './engine/systems/economy.js';
export { createUpgradeStore } from './engine/systems/upgrades.js';
export { createAutomation, createOffline } from './engine/systems/automation.js';
export { serializeSession, deserializeSession } from './engine/systems/codecs.js';
export { createSaveCodec } from './engine/systems/save.js';
export { createCommandBus, registerCommand } from './engine/systems/commands.js';
export { createEventQueue } from './engine/systems/events.js';
export { toDecimal, toNumber, serializeDecimal, deserializeDecimal } from './engine/systems/decimal.js';
export { toNum, countById, neighborInstances, createSustainedTracker, CARDINAL_OFFSETS } from './engine/kernel/gridUtils.js';
export { createObjectiveSystem, createAchievementSystem } from './engine/systems/progression.js';
export { createFailureSystem } from './engine/systems/failure.js';
export { deriveReactorStats, createReactorStatsComputer } from './engine/systems/reactorStats.js';
export { computeNeighborPulseN, runCellPhase } from './engine/reactor/phases/cellPhase.js';
export { runHeatPipeline, runVentPhase } from './engine/reactor/heat/heatPipeline.js';
export { collectOverpressureExplosions, explodeComponent, applyHullRepulsion } from './engine/reactor/explosions.js';
export { runReactorMechanicsPhase } from './engine/reactor/reactorMechanics.js';
export {
  applyBlueprintLayoutDiff,
  computeBlueprintDiff,
  layoutFromPlannerSlots,
  gridToLayout,
  clipToGrid,
  sellAllComponents,
} from './engine/systems/blueprint.js';
export { createIncrementalPhaseRunners } from './engine/reactor/phases/incrementalPhaseRunners.js';
export { serializeRevivalSession, deserializeRevivalSession, decodeLegacySave } from './games/reactor_revival/persistence.js';
export { topologyNeighborCoords, Topology, TOPOLOGY_TYPES } from './engine/kernel/neighborTopology.js';

export const GAME_IDS = [
  'ic2_reactor_planner_v3',
  'ic2_exp_reactor_planner',
  'reactor_incremental',
  'reactor_knockoff',
  'reactor_revival',
];

export { createGameLoader, createGameSession, createHeadlessRunner, createHistoryManager } from './engine/runtime/createGameSession.js';
export { loadGameManifest, composeGameManifest } from './engine/runtime/loadGameManifest.js';
export { runBatchTicks } from './engine/runtime/runBatchTicks.js';
export { createRegistry } from './engine/kernel/createRegistry.js';
export { createHookBus } from './engine/kernel/createHookBus.js';
export { validateManifest, assertCapability } from './engine/kernel/validateManifest.js';
export { createReactorGrid } from './engine/reactor/createReactorGrid.js';
export { createTickEngine, copyCellOutputs } from './engine/reactor/createTickEngine.js';
export { buildBehavior, buildDefinitionsFromManifest } from './engine/reactor/behaviors/index.js';
export { createInstance, cloneInstance, preTick, isBroken } from './engine/reactor/createInstance.js';
export { createEconomy } from './engine/systems/economy.js';
export { createUpgradeStore } from './engine/systems/upgrades.js';
export { compileMechanicsOverrides, buildAutoReplaceCosts, partAutoReplaceCost, isPartPerpetual, CAPACITOR_AUTO_REPLACE_MULTIPLIER, PERPETUAL_AUTO_REPLACE_MULTIPLIER } from './engine/systems/mechanicsPolicy.js';
export { listCompiledParts, getCompiledPart, projectCompiledPart, compilePartStats } from './engine/systems/partCatalog.js';
export { formatPartDescription, getPartDescription } from './engine/systems/partDescription.js';
export { resolveEpHeat, CATALYST_REDUCTION_CAP, DEFAULT_WEAVE_QUANTUM } from './engine/systems/epHeat.js';
export { calculateWeaveEp, previewPrestige } from './engine/systems/prestige.js';
export { createAutomation, createOffline } from './engine/systems/automation.js';
export { serializeSession, deserializeSession } from './engine/systems/codecs.js';
export { createSaveCodec } from './engine/systems/save.js';
export { createCommandBus, registerCommand, normalizeCommand } from './engine/systems/commands.js';
export {
  getPlacedCount,
  incrementPlacedCount,
  rebuildPlacedCountsFromGrid,
  clearPlacedCounts,
  placedCountKey,
} from './engine/systems/placedCounts.js';
export {
  deriveActiveParts,
  getActivePartList,
  classifyActivePart,
} from './engine/systems/activeParts.js';
export {
  queryNeighbors,
  countNeighborCategoryLevels,
} from './engine/systems/neighborQuery.js';
export { createEventQueue } from './engine/systems/events.js';
export { toDecimal, toNumber, serializeDecimal, deserializeDecimal } from './engine/systems/decimal.js';
export { toNum, isValidGridCoord, countById, neighborInstances, createSustainedTracker, CARDINAL_OFFSETS } from './engine/kernel/gridUtils.js';
export { createObjectiveSystem, createAchievementSystem } from './engine/systems/progression.js';
export { createFailureSystem } from './engine/systems/failure.js';
export { deriveReactorStats, createReactorStatsComputer, heatPowerMultiplier } from './engine/systems/reactorStats.js';
export {
  computeNeighborPulseN,
  countActiveReflectorNeighbors,
  runCellPhase,
  computeCellOutput,
  resolveCellCoefficients,
  projectCellOutputs,
  describeCellPulse,
} from './engine/reactor/phases/cellPhase.js';
export { runHeatPipeline, runVentPhase, heatTransfersToVectors, copyHeatFlowVectors } from './engine/reactor/heat/heatPipeline.js';
export {
  computeGridMultiplierBonuses,
  resolveTransferRate,
  resolveVentRate,
  resolveContainment,
  resolveDisplayRates,
  resolvePartDisplayRates,
  sumCategoryLevels,
} from './engine/reactor/heat/effectiveRates.js';
export { buildContainmentSegments, getHeatSegmentAt } from './engine/reactor/heat/containmentSegments.js';
export { getTileFlowDiagnostics } from './engine/reactor/heat/heatFlowDiagnostics.js';
export { collectOverpressureExplosions, explodeComponent, applyHullRepulsion } from './engine/reactor/explosions.js';
export { runReactorMechanicsPhase } from './engine/reactor/reactorMechanics.js';
export {
  applyBlueprintLayoutDiff,
  computeBlueprintDiff,
  computeBlueprintCostBreakdown,
  computeAbsoluteLayoutCost,
  computeGridSellCredit,
  computePartSellValue,
  computeInstanceSellValue,
  partSellCost,
  filterAffordablePlacements,
  previewPartialBlueprint,
  partCostForCell,
  partUsesEp,
  layoutFromPlannerSlots,
  gridToLayout,
  clipToGrid,
  sellAllComponents,
  applyBlueprintPayload,
  checkLayoutAffordability,
} from './engine/systems/blueprint.js';
export { projectModifiersForHost, MODIFIER_HOST_ALIASES } from './engine/systems/modifierProjection.js';
export { createIncrementalPhaseRunners } from './engine/reactor/phases/incrementalPhaseRunners.js';
export { serializeRevivalSession, deserializeRevivalSession, decodeLegacySave } from './games/reactor_revival/persistence.js';
export { topologyNeighborCoords, Topology, TOPOLOGY_TYPES } from './engine/kernel/neighborTopology.js';
export { createTechTreePurchaseGate } from './games/reactor_revival/systems/revival-upgrades.js';
export { createRevivalUpgradeStore } from './games/reactor_revival/systems/revival-upgrades.js';

export const GAME_IDS = [
  'ic2_reactor_planner_v3',
  'ic2_exp_reactor_planner',
  'reactor_incremental',
  'reactor_knockoff',
  'reactor_revival',
];

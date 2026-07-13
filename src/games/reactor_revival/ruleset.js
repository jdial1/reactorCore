import { createAutomation, createOffline } from '../../engine/systems/automation.js';
import { createFailureSystem } from '../../engine/systems/failure.js';
import { createReactorStatsComputer } from '../../engine/systems/reactorStats.js';
import {
  applyBlueprintLayoutDiff,
  layoutFromPlannerSlots,
  sellAllComponents,
} from '../../engine/systems/blueprint.js';
import { createRevivalEconomy, createRevivalUpgradeStore } from './economy-policy.js';
import { createObjectiveSystem, createRevivalAchievements } from './progression.js';
import { createRevivalPhaseRunners, createRevivalAutomation } from './simulation-policy.js';
import { createRevivalSaveCodec } from './persistence.js';

export function createRuleset({ manifest }) {
  const saveCodec = createRevivalSaveCodec(manifest);
  const offlineSystem = createOffline(manifest);

  return {
    id: manifest.id,

    createPipeline() {
      const stages = ['intents', 'preTick', 'cells', 'heat', 'automation', 'vents', 'destroy', 'economy', 'failure', 'objectives'];
      if (manifest.features?.achievements) stages.push('achievements');
      return { loopOrder: 'legacy', stages };
    },

    createSystems({ manifest: m, hooks }) {
      return {
        economy: createRevivalEconomy(m),
        upgrades: createRevivalUpgradeStore(m),
        automation: createRevivalAutomation(),
        failure: createFailureSystem(m),
        objectives: createObjectiveSystem(m, { hooks }),
        achievements: m.features?.achievements ? createRevivalAchievements(m, { hooks }) : undefined,
        stats: createReactorStatsComputer(m),
      };
    },

    createPhaseRunners() {
      return createRevivalPhaseRunners(manifest);
    },

    createOffline() {
      return offlineSystem;
    },

    createSaveCodec() {
      return saveCodec;
    },

    registerCommands(registerCommand) {
      registerCommand('APPLY_BLUEPRINT', (session, payload) => {
        if (!payload?.layout) return { ok: false, reason: 'invalid' };
        if (payload.sellExisting) sellAllComponents(session);
        return applyBlueprintLayoutDiff(session, payload.layout, {
          skipCostDeduction: payload.skipCostDeduction === true,
          partial: payload.partial === true,
          sellCredit: payload.sellCredit ?? 0,
        });
      });
      registerCommand('COMMIT_BLUEPRINT_PLANNER', (session, payload) => {
        const layout = layoutFromPlannerSlots(session, payload?.slots);
        if (!layout) return { ok: false, reason: 'empty' };
        const result = applyBlueprintLayoutDiff(session, layout, { partial: payload?.partial === true });
        if (result.ok) {
          session.blueprintPlanner = { slots: {}, active: false };
          session.events?.emit('blueprintPlannerCommitted', result);
          session.events?.emit('blueprintPlannerChanged', {
            netHeat: result.netHeat,
            power: result.power,
          });
        }
        return result;
      });
    },

    extendSnapshot(session, snapshot) {
      return {
        ...snapshot,
        runId: session.runId,
        techTree: session.techTree,
        totalPlayedTime: session.totalPlayedTime,
        lastSaveTime: session.lastSaveTime,
        placedCounts: { ...session.placedCounts },
      };
    },

    onSessionInit({ grid, systems }) {
      grid.recalculateCaps();
      systems.failure?.reset?.();
    },

    onPrestige(session, { refundEp = false } = {}) {
      if (!refundEp) session.systems.upgrades?.deserialize([]);
      session.systems.failure?.reset?.();
      session.systems.objectives?.setIndex?.(0);
    },
  };
}

import { createPhaseRunners } from '../createPhaseRunners.js';
import { isBroken } from '../createInstance.js';
import { runCellPhase } from './cellPhase.js';
import { runHeatPipeline, runVentPhase } from '../heat/heatPipeline.js';
import { collectOverpressureExplosions, explodeComponent } from '../explosions.js';
import { runReactorMechanicsPhase } from '../reactorMechanics.js';
import { partAutoReplaceCost } from '../../systems/mechanicsPolicy.js';

export function createIncrementalPhaseRunners(manifest, policy = {}) {
  const base = createPhaseRunners(manifest.features);
  const isAutoReplaceEligible = policy.isAutoReplaceEligible
    ?? ((def, overrides = {}) => {
      const perpetualPartIds = overrides.perpetualPartIds;
      if (perpetualPartIds?.has?.(def.id) || perpetualPartIds?.[def.id]) return true;
      if (overrides.perpetualCategories?.[def.category]) return true;
      if (def.perpetual) return true;
      return false;
    });
  const autoReplaceCost = policy.autoReplaceCost
    ?? ((def, overrides = {}) => partAutoReplaceCost(def, overrides));

  return {
    ...base,

    intents(ctx) {
      ctx.commands?.drain(ctx.session);
    },

    cells(ctx) {
      if (!ctx.active) return;
      runCellPhase(ctx, policy.cellPhase);
    },

    heat(ctx) {
      if (ctx.features.exchangerRouting || ctx.features.valveMechanics || ctx.features.tileHeatMap) {
        runHeatPipeline(ctx);
      }
    },

    vents(ctx) {
      runVentPhase(ctx);
      runReactorMechanicsPhase(ctx);
    },

    destroy(ctx) {
      if (ctx.features.containmentExplosions) {
        const candidates = ctx.result.explosionSnapshot || collectOverpressureExplosions(ctx);
        ctx.result.explosionSnapshot = null;
        for (let i = 0; i < candidates.length; i++) {
          const { row, col, inst } = candidates[i];
          if (!inst.pendingDestruction) explodeComponent(ctx, row, col, inst);
        }
        if (candidates.length) ctx.result.explosionCount = (ctx.result.explosionCount || 0) + candidates.length;
      }
      const overrides = ctx.session?.mechanicsOverrides || {};
      ctx.grid.forEach((row, col, inst) => {
        if (!inst || inst.pendingDestruction) return;
        const def = inst.definition;
        if (!def.baseTicks || inst.ticks > 0) return;
        if (ctx.session?.toggles?.auto_buy && isAutoReplaceEligible(def, overrides)) return;
        inst.pendingDestruction = true;
      });
      base.destroy(ctx);
    },

    automation(ctx) {
      if (!ctx.features.autoReplace || !ctx.session?.toggles?.auto_buy || !ctx.automation) return;
      const result = ctx.automation.processTick(ctx);
      if (result.replacements.length) {
        ctx.result.automationReplacements = result.replacements;
        ctx.session?.events?.emit('automationReplace', { replacements: result.replacements });
      }
    },

    failure(ctx) {
      if (!ctx.features.failureStates || !ctx.failure) {
        base.meltdown(ctx);
        return;
      }
      ctx.failure.evaluate(ctx);
    },

    objectives(ctx) {
      if (!ctx.features.objectives || !ctx.objectives) return;
      ctx.objectives.checkCurrent(ctx.session);
    },

    achievements(ctx) {
      if (!ctx.features.achievements || !ctx.achievements) return;
      ctx.achievements.evaluate(ctx);
    },
  };
}

export function createRevivalAutomationPolicy(manifest) {
  return {
    isAutoReplaceEligible(def, overrides = {}) {
      const perpetualPartIds = overrides.perpetualPartIds;
      if (perpetualPartIds?.has?.(def.id) || perpetualPartIds?.[def.id]) return true;
      const perpetualCategories = overrides.perpetualCategories || {};
      if (perpetualCategories[def.category]) return true;
      if (def.perpetual) return true;
      if (def.type === 'protium' && overrides.hasProtiumLoader) return true;
      return false;
    },
    autoReplaceCost(def, overrides = {}) {
      if (overrides.autoReplaceCosts?.[def.id] != null) return overrides.autoReplaceCosts[def.id];
      return partAutoReplaceCost(def, overrides);
    },
    onReplace(row, col, def, economy, overrides = {}) {
      const cost = overrides.autoReplaceCosts?.[def.id] ?? partAutoReplaceCost(def, overrides);
      return economy.spendMoney(cost);
    },
  };
}

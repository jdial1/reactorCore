import { createIncrementalPhaseRunners, createRevivalAutomationPolicy } from '../../engine/reactor/phases/incrementalPhaseRunners.js';
import { createAutomation } from '../../engine/systems/automation.js';

const revivalAutomation = createRevivalAutomationPolicy();

export function createRevivalPhaseRunners(manifest) {
  return createIncrementalPhaseRunners(manifest, {
    cellPhase: {
      onCellDepleted(ctx, { def }) {
        if (def.id?.startsWith('protium') || def.type === 'protium') {
          ctx.economy?.addProtiumParticles?.(def.cellCount ?? def.cell_count ?? 1);
        }
      },
    },
    isAutoReplaceEligible: revivalAutomation.isAutoReplaceEligible,
    autoReplaceCost: revivalAutomation.autoReplaceCost,
  });
}

export function createRevivalAutomation() {
  return createAutomation({
    isEligible(row, col, def, instance, ctx) {
      if (ctx.session?.toggles?.auto_buy !== true) return false;
      if (instance.pendingDestruction) return false;
      return revivalAutomation.isAutoReplaceEligible(def, ctx.session?.mechanicsOverrides || {});
    },
    onReplace(row, col, def, economy, ctx) {
      return revivalAutomation.onReplace(row, col, def, economy, ctx.session?.mechanicsOverrides || {});
    },
  });
}

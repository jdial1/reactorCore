import { preTick, isBroken } from './createInstance.js';

function runPhase(grid, callback) {
  grid.forEach((row, col, instance) => {
    if (instance && !instance.pendingDestruction && !isBroken(instance)) {
      callback(instance, row, col);
    }
  });
}

export function createPhaseRunners(features) {
  const legacyOrder = features.legacyLoopOrder;

  function processLegacyLoopOrder(grid, active, destroyedComponents, ctx) {
    let totalHeat = 0;
    runPhase(grid, (inst, r, c) => {
      if (active) totalHeat += inst.definition.generateHeat(inst, grid, r, c, ctx);
      inst.definition.dissipate(inst, grid, r, c, ctx);
      inst.definition.transfer(inst, grid, r, c, ctx);
      if (inst.pendingDestruction) {
        destroyedComponents.push({ row: r, col: c, id: inst.definition.id, name: inst.definition.name });
      }
    });
    if (active) {
      runPhase(grid, (inst, r, c) => inst.definition.generateEnergy(inst, grid, r, c, ctx));
    }
    return totalHeat;
  }

  function processDoubleBuffered(grid, active, destroyedComponents, ctx) {
    let totalHeat = 0;
    runPhase(grid, (inst, r, c) => {
      if (active) totalHeat += inst.definition.generateHeat(inst, grid, r, c, ctx);
      if (inst.pendingDestruction) {
        destroyedComponents.push({ row: r, col: c, id: inst.definition.id, name: inst.definition.name });
      }
    });
    runPhase(grid, (inst, r, c) => inst.definition.dissipate(inst, grid, r, c, ctx));
    runPhase(grid, (inst, r, c) => inst.definition.transfer(inst, grid, r, c, ctx));
    if (active) {
      runPhase(grid, (inst, r, c) => inst.definition.generateEnergy(inst, grid, r, c, ctx));
    }
    return totalHeat;
  }

  return {
    preTick(ctx) {
      ctx.grid.clearTickCounters();
      ctx.grid.forEach((_, __, inst) => { if (inst) preTick(inst); });
    },

    environment(ctx) {
      if (!ctx.features.environmentalCooling || !ctx.environment) return;
      const env = ctx.environment;
      const cooling = ctx.manifest.environmentalCooling;
      if (!cooling) return;
      let total = 0;
      if (env.adjacentWaterBlocks > 0) {
        total += Math.min(env.adjacentWaterBlocks, cooling.waterBlock.maxAdjacent) * cooling.waterBlock.heatPerTick;
      }
      if (env.adjacentIceBlocks > 0) {
        total += Math.min(env.adjacentIceBlocks, cooling.iceBlock.maxAdjacent) * cooling.iceBlock.heatPerTick;
      }
      if (env.biomeModifier) total *= env.biomeModifier;
      ctx.grid.adjustCurrentHeat(-total);
      ctx.result.ventedHeat += total;
    },

    generateHeat(ctx) {
      const destroyed = ctx.result.destroyedComponents;
      const totalHeat = legacyOrder
        ? processLegacyLoopOrder(ctx.grid, ctx.active, destroyed, ctx)
        : processDoubleBuffered(ctx.grid, ctx.active, destroyed, ctx);
      ctx.result.heatOutput = totalHeat;
    },

    destroy(ctx) {
      if (!ctx.features.pendingDestruction) return;
      ctx.grid.forEach((r, c, instance) => {
        if (instance && instance.pendingDestruction) {
          ctx.result.destroyedComponents.push({
            row: r, col: c, id: instance.definition.id, name: instance.definition.name,
          });
          ctx.grid.setComponentAt(r, c, null);
        }
      });
    },

    enrich(ctx) {
      if (!ctx.features.breederMechanics) return;
      ctx.grid.forEach((r, c, instance) => {
        if (!instance || !instance.definition.isBreederCell || isBroken(instance) || instance.converted) return;
        if (instance.definition.processEnrichment) {
          const result = instance.definition.processEnrichment(instance, ctx.grid, r, c);
          if (result?.converted) {
            ctx.result.enrichedCells.push({
              row: r, col: c, id: instance.definition.id, name: instance.definition.name,
              enrichmentProgress: result.enrichmentProgress,
            });
          }
        }
      });
    },

    economy(ctx) {
      if (!ctx.economy) return;
      ctx.economy.processTick(ctx);
    },

    meltdown(ctx) {
      const threshold = ctx.manifest.mechanics?.meltdownThreshold;
      if (threshold === 'currentHeat > maxHeat * 2') {
        ctx.result.meltdown = ctx.grid.currentHeat > ctx.grid.maxHeat * 2;
      } else {
        ctx.result.meltdown = ctx.grid.currentHeat >= ctx.grid.maxHeat;
      }
      ctx.meltdown = ctx.result.meltdown;
    },
  };
}

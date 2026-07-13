import {
  deterministicChance,
  deterministicPickIndex,
  FRAGMENTATION_EXPLOSION_CHANCE,
  FRAGMENTATION_SALT_HULL_REPEL,
  FRAGMENTATION_SALT_STRUCTURAL,
} from '../kernel/deterministic-tick-rng.js';
import { applyHullRepulsion } from '../reactor/explosions.js';

const MELTDOWN_HEAT_MULTIPLIER = 2;

export function createFailureSystem(manifest) {
  const failureMech = manifest.mechanics?.failure || {};
  const meltdownMultiplier = failureMech.meltdownHeatMultiplier
    ?? manifest.mechanics?.meltdownHeatMultiplier ?? MELTDOWN_HEAT_MULTIPLIER;
  const fragmentationChance = failureMech.fragmentationExplosionChance ?? FRAGMENTATION_EXPLOSION_CHANCE;

  let gracePeriodTicks = manifest.mechanics?.gracePeriodTicks ?? failureMech.gracePeriodTicks ?? 30;
  let failureState = 'nominal';
  let hullIntegrity = 100;
  let hasMeltedDown = false;

  function collectActiveTiles(ctx) {
    const tiles = [];
    ctx.grid.forEach((row, col, inst) => {
      if (inst && !inst.pendingDestruction) tiles.push({ row, col, inst });
    });
    return tiles;
  }

  function tryFragmentationExplosion(ctx, salt) {
    if (!deterministicChance(ctx.session?.engine?.tickCount ?? 0, salt, fragmentationChance)) return;
    const tiles = collectActiveTiles(ctx);
    if (tiles.length === 0) return;
    const pick = deterministicPickIndex(ctx.session?.engine?.tickCount ?? 0, salt + 1, tiles.length);
    if (pick < 0) return;
    const target = tiles[pick];
    target.inst.pendingDestruction = true;
    ctx.result.destroyedComponents.push({
      row: target.row,
      col: target.col,
      id: target.inst.definition.id,
      name: target.inst.definition.displayName || target.inst.definition.name,
      reason: 'fragmentation',
    });
    ctx.session?.events?.emit('fragmentationExplosion', { row: target.row, col: target.col });
  }

  function triggerMeltdown(ctx) {
    hasMeltedDown = true;
    failureState = 'criticality';
    hullIntegrity = 0;
    ctx.result.meltdown = true;
    ctx.meltdown = true;
    ctx.session?.events?.emit('meltdown', { tickCount: ctx.session?.engine?.tickCount ?? 0 });
  }

  return {
    get failureState() { return failureState; },
    get hullIntegrity() { return hullIntegrity; },
    get hasMeltedDown() { return hasMeltedDown; },
    get gracePeriodTicks() { return gracePeriodTicks; },

    setGracePeriodTicks(value) {
      gracePeriodTicks = Math.max(0, Math.floor(value));
    },

    evaluate(ctx) {
      if (hasMeltedDown) {
        ctx.result.meltdown = true;
        return true;
      }

      if (gracePeriodTicks > 0) {
        gracePeriodTicks--;
        failureState = 'nominal';
        hullIntegrity = 100;
        ctx.result.meltdown = false;
        ctx.result.failureState = failureState;
        ctx.result.hullIntegrity = hullIntegrity;
        return false;
      }

      const heat = ctx.grid.currentHeat;
      const max = ctx.grid.maxHeat;

      if (heat > max) {
        if (failureState === 'fragmentation') tryFragmentationExplosion(ctx, FRAGMENTATION_SALT_HULL_REPEL);
        applyHullRepulsion(ctx);
      }

      if (heat < max) {
        failureState = 'nominal';
        hullIntegrity = 100;
        ctx.result.meltdown = false;
        ctx.result.failureState = failureState;
        ctx.result.hullIntegrity = hullIntegrity;
        return false;
      }

      if (heat >= max && heat < max * 1.1) failureState = 'saturation';
      else if (heat >= max * 1.1 && hullIntegrity > 0) {
        failureState = 'repulsion';
        const overpressure = (heat - max * 1.1) / max;
        hullIntegrity = Math.max(0, hullIntegrity - overpressure * 5);
      } else if (hullIntegrity <= 0 && heat < max * meltdownMultiplier) {
        failureState = 'fragmentation';
        tryFragmentationExplosion(ctx, FRAGMENTATION_SALT_STRUCTURAL);
      }

      if (heat > max * meltdownMultiplier) {
        triggerMeltdown(ctx);
        return true;
      }

      ctx.result.meltdown = false;
      ctx.result.failureState = failureState;
      ctx.result.hullIntegrity = hullIntegrity;
      return false;
    },

    reset() {
      failureState = 'nominal';
      hullIntegrity = 100;
      hasMeltedDown = false;
    },

    serialize() {
      return { failureState, hullIntegrity, hasMeltedDown, gracePeriodTicks };
    },

    deserialize(data) {
      if (!data) return;
      failureState = data.failureState ?? failureState;
      hullIntegrity = data.hullIntegrity ?? hullIntegrity;
      hasMeltedDown = data.hasMeltedDown ?? hasMeltedDown;
      gracePeriodTicks = data.gracePeriodTicks ?? gracePeriodTicks;
    },
  };
}

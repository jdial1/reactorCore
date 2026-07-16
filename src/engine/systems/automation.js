import { createInstance } from '../reactor/createInstance.js';
import { isBroken } from '../reactor/createInstance.js';

export function createAutomation(options = {}) {
  const { onReplace, onCondensatorInject, isEligible } = options;

  return {
    processTick(ctxOrGrid, registry, economy) {
      const ctx = ctxOrGrid?.grid ? ctxOrGrid : { grid: ctxOrGrid, registry, economy };
      const grid = ctx.grid;
      const reg = ctx.registry ?? registry;
      const eco = ctx.economy ?? economy;
      const replacements = [];
      const coolantInjections = [];

      grid.forEach((row, col, instance) => {
        if (!instance) return;
        const def = instance.definition;

        if (isBroken(instance) || (instance.ticks === 0 && def.baseTicks)) {
          if (instance.pendingDestruction) return;
          if (isEligible && !isEligible(row, col, def, instance, ctx)) return;
          if (onReplace) {
            const canAfford = onReplace(row, col, def, eco, ctx);
            if (canAfford) {
              const newInstance = reg?.create?.(def.id) ?? createInstance(def);
              if (def.baseTicks) newInstance.ticks = def.baseTicks;
              grid.setComponentAt(row, col, newInstance);
              replacements.push({ row, col, id: def.id });
            }
          }
          return;
        }

        if (def.isCondensator && def.needsCoolantInjected?.(instance)) {
          if (onCondensatorInject?.(row, col, def, eco, ctx)) {
            def.injectCoolant(instance);
            coolantInjections.push({ row, col, id: def.id });
          }
        }
      });

      return { replacements, coolantInjections };
    },
  };
}

export function createOffline(manifest, options = {}) {
  const tickRateMs = manifest.tickRateMs || 1000;
  const offline = manifest.mechanics?.offline || {};
  const welcomeBackThresholdMs = options.welcomeBackThresholdMs ?? offline.welcomeBackThresholdMs ?? 0;
  const maxCatchupTicks = options.maxCatchupTicks ?? offline.maxCatchupTicks ?? Infinity;
  const maxCatchupMs = options.maxCatchupMs ?? offline.maxCatchupMs ?? maxCatchupTicks * tickRateMs;

  return {
    welcomeBackThresholdMs,
    maxCatchupTicks,
    maxCatchupMs,
    tickRateMs,

    shouldWelcomeBack: (elapsedMs) => welcomeBackThresholdMs > 0 && elapsedMs > welcomeBackThresholdMs,
    clampElapsedMs: (elapsedMs) => Math.min(Math.max(0, elapsedMs), maxCatchupMs),

    computeTicks(elapsedMs, upgrades) {
      const clamped = this.clampElapsedMs(elapsedMs);
      const bonus = upgrades?.compileModifiers()?.tickRateBonus || 0;
      const ticksPerSecond = (1000 / tickRateMs) + bonus;
      const ticks = Math.floor((clamped / 1000) * ticksPerSecond);
      return Math.min(ticks, maxCatchupTicks);
    },

    runOffline(session, elapsedMs) {
      const ticks = this.computeTicks(elapsedMs, session.systems.upgrades);
      if (ticks <= 0) return { ticksProcessed: 0, results: [] };
      session.isCatchingUp = true;
      const results = session.runTicks(ticks);
      session.isCatchingUp = false;
      return { ticksProcessed: results.length, results };
    },
  };
}

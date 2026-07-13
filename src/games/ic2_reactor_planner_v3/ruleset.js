export function createRuleset({ manifest }) {
  return {
    id: manifest.id,

    createPipeline() {
      return {
        loopOrder: 'legacy',
        stages: ['preTick', 'environment', 'generateHeat', 'destroy', 'enrich', 'meltdown'],
      };
    },

    createSystems() {
      return {
        economy: null,
        upgrades: null,
        automation: null,
      };
    },

    onSessionInit() {},

    simulateGenerationCooldown(session, options = {}) {
      const maxTicks = options.maxTicks || 10000;
      const lavaThreshold = options.lavaThreshold ?? 0.85;
      const grid = session.grid;
      const engine = session.engine;

      engine.reset();
      grid.recalculateCaps();

      let generationTicks = 0;
      let stoppedByMelt = false;
      let stoppedByLava = false;

      while (generationTicks < maxTicks && !engine.meltdown) {
        const result = session.tick();
        generationTicks++;
        if (result.destroyedComponents.length > 0) {
          stoppedByMelt = true;
          break;
        }
        if (grid.currentHeat >= grid.maxHeat * lavaThreshold) {
          stoppedByLava = true;
          break;
        }
      }

      const cooldownStartHeat = grid.currentHeat;
      let cooldownTicks = 0;
      const cooldownMax = options.cooldownMaxTicks || maxTicks;

      while (cooldownTicks < cooldownMax && grid.currentHeat > 0 && !engine.meltdown) {
        session.tick();
        cooldownTicks++;
      }

      return {
        generationTicks,
        cooldownTicks,
        stoppedByMelt,
        stoppedByLava,
        cooldownStartHeat,
        finalHeat: grid.currentHeat,
        meltdown: engine.meltdown,
      };
    },
  };
}

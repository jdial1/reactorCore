export function createRuleset({ manifest }) {
  return {
    id: manifest.id,

    createPipeline() {
      return {
        loopOrder: 'doubleBuffered',
        stages: ['preTick', 'generateHeat', 'destroy', 'meltdown'],
      };
    },

    createSystems() {
      return {
        economy: null,
        upgrades: null,
        automation: null,
      };
    },

    onSessionInit({ grid }) {
      grid.recalculateCaps();
    },

    setMode(session, mode) {
      const modeDef = manifest.modes?.[mode];
      if (!modeDef) throw new Error(`Unknown mode: ${mode}`);
      session.grid.fluid = !!modeDef.fluidMode;
    },
  };
}

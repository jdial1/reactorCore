export function createPipeline(stages, runners) {
  const stageList = stages.slice();

  return {
    get stages() { return stageList; },

    run(ctx) {
      for (const stage of stageList) {
        const runner = runners[stage];
        if (!runner) throw new Error(`Missing stage runner: ${stage}`);
        ctx.hooks.emit(`stage:${stage}:before`, ctx);
        runner(ctx);
        ctx.hooks.emit(`stage:${stage}:after`, ctx);
      }
    },
  };
}

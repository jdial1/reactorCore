import { createAchievementSystem } from '../../engine/systems/progression.js';
import { deriveReactorStats } from '../../engine/systems/reactorStats.js';
import { toNum, countById, neighborInstances, CARDINAL_OFFSETS } from '../../engine/kernel/gridUtils.js';
import { isBroken } from '../../engine/reactor/createInstance.js';
import { OBJECTIVE_CHECKS } from './progression-checks.js';

export { OBJECTIVE_CHECKS } from './progression-checks.js';

const HEAT_EPSILON = 0.001;
const CRITICALITY_RATIO = 2;

const TICK_CHECK_THRESHOLDS = {
  repulsion_60ticks: 60,
  heat_95pct_120ticks: 120,
  max_heat_power_500k_10ticks: 10,
};

const EXPERIMENTAL_PART_UNLOCK_IDS = [
  'heat_reflection',
  'experimental_capacitance',
  'vortex_cooling',
  'underground_heat_extraction',
  'vortex_extraction',
  'explosive_ejection',
  'thermionic_conversion',
  'micro_capacitance',
  'singularity_harnessing',
];

function hasExchangerOrCoolant(grid) {
  let found = false;
  grid.forEach((_, __, inst) => {
    const cat = inst?.definition?.category;
    if (cat === 'heat_exchanger' || cat === 'coolant_cell') found = true;
  });
  return found;
}

function sumGridPartCost(grid) {
  let total = 0;
  grid.forEach((_, __, inst) => { total += inst?.definition?.baseCost || 0; });
  return total;
}

function hasOnlyProtiumCells(grid) {
  let hasProtium = false;
  let hasOther = false;
  grid.forEach((_, __, inst) => {
    if (inst?.definition?.category !== 'cell' || inst.ticks <= 0) return;
    if (inst.definition.id.startsWith('protium')) hasProtium = true;
    else hasOther = true;
  });
  return hasProtium && !hasOther;
}

function cellSurroundedBy(grid, predicate) {
  let found = false;
  grid.forEach((row, col, inst) => {
    if (found || inst?.definition?.category !== 'cell' || inst.ticks <= 0) return;
    const neighbors = neighborInstances(grid, row, col, CARDINAL_OFFSETS);
    if (neighbors.length === 4 && neighbors.every(predicate)) found = true;
  });
  return found;
}

const INSTANT_CONDITIONS = {
  criticality_no_vents: (v) => v.heatRatio >= CRITICALITY_RATIO && v.ventCount === 0,
  net_heat_zero_power_5k: (v) => Math.abs(v.stats.netHeat) < HEAT_EPSILON && v.stats.power >= 5000,
  closed_loop_no_vents: (v) => !v.paused && v.stats.netHeat <= HEAT_EPSILON && v.ventCount === 0 && hasExchangerOrCoolant(v.grid),
  zero_heat_power_10k: (v) => v.grid.currentHeat === 0 && v.stats.power > 10000,
  stirling_power_1k: (v) => v.stats.stirlingPower >= 1000 && v.stats.cellPower < HEAT_EPSILON,
  stirling_exceeds_cell_power: (v) => v.stats.stirlingPower > 0 && v.stats.cellPower > 0 && v.stats.stirlingPower > v.stats.cellPower,
  power_100k_grid_36: (v) => v.stats.power > 100000 && v.grid.rows * v.grid.cols <= 36,
  power_5m_no_vents: (v) => v.stats.power > 5_000_000 && v.ventCount === 0,
  high_power_low_budget: (v) => v.stats.power > 1_000_000 && sumGridPartCost(v.grid) < 50000,
  exchangers_max_capacity(v) {
    let count = 0;
    let allFull = true;
    v.grid.forEach((row, col, inst) => {
      if (inst?.definition?.category !== 'heat_exchanger') return;
      const cap = inst.definition.containment || 0;
      if (cap <= 0 || (v.grid.getTileHeat(row, col) || 0) / cap < 1 - HEAT_EPSILON) allFull = false;
      count++;
    });
    return count > 0 && allFull;
  },
  four_inlets_one_cell: (v) => cellSurroundedBy(v.grid, (n) => n.definition.category === 'heat_inlet'),
  heat_lock_loop: (v) => cellSurroundedBy(v.grid, (n) => n.definition.id === 'check_valve'),
  accelerator6_count_4: (v) => countById(v.grid, 'particle_accelerator6') >= 4,
  lab_unlocked: (v) => (v.upgrades?.getLevel('laboratory') || 0) >= 1,
  protium_cells_10(v) {
    let count = 0;
    v.grid.forEach((_, __, inst) => {
      if (inst?.definition?.category === 'cell' && inst.definition.id.startsWith('protium') && inst.ticks > 0) count++;
    });
    return count >= 10;
  },
  reflector6_count_12: (v) => countById(v.grid, 'reflector6') >= 12,
  coolant6_count_15: (v) => countById(v.grid, 'coolant_cell6') >= 15,
  inlet6_outlet6_active: (v) => countById(v.grid, 'heat_inlet6') >= 1 && countById(v.grid, 'heat_outlet6') >= 1,
  vent6_count_8: (v) => countById(v.grid, 'vent6') >= 8,
  power_50m_protium_only: (v) => v.stats.power > 50_000_000 && hasOnlyProtiumCells(v.grid),
  sub_atomic_catalysts_lvl_10: (v) => (v.upgrades?.getLevel('sub_atomic_catalysts') || 0) >= 10,
  black_hole_critical(v) {
    let critical = false;
    v.grid.forEach((row, col, inst) => {
      if (inst?.definition?.id !== 'particle_accelerator6') return;
      const cap = inst.definition.containment || inst.definition.epHeat || 0;
      if (cap > 0 && (v.grid.getTileHeat(row, col) || 0) / cap >= 0.99) critical = true;
    });
    return critical;
  },
  all_experimental_parts_unlocked: (v) => EXPERIMENTAL_PART_UNLOCK_IDS.every((id) => (v.upgrades?.getLevel(id) || 0) >= 1),
  sympathetic_resonance_quad(v) {
    let found = false;
    v.grid.forEach((row, col, inst) => {
      if (found || inst?.definition?.category !== 'reflector' || isBroken(inst)) return;
      const neighbors = neighborInstances(v.grid, row, col, CARDINAL_OFFSETS);
      if (neighbors.length === 4 && neighbors.every((n) => n.definition.id === 'plutonium3' && n.ticks > 0)) found = true;
    });
    return found;
  },
  frozen_fire_nefastium(v) {
    let found = false;
    v.grid.forEach((row, col, inst) => {
      if (inst?.definition?.id === 'nefastium3' && inst.ticks > 0 && (v.grid.getTileHeat(row, col) || 0) === 0) found = true;
    });
    return found;
  },
  simultaneous_explosions_10: (v) => v.tickExplosions === 10,
  criticality_recovery_auto(v, tracker) {
    if (!tracker.recovery) tracker.recovery = { phase: 'idle', manualVentsAtEntry: 0 };
    const tr = tracker.recovery;
    if (tr.phase === 'idle' && v.heatRatio > 1.5) {
      tr.phase = 'critical';
      tr.manualVentsAtEntry = v.manualVents;
      return false;
    }
    if (tr.phase !== 'critical') return false;
    if (v.manualVents !== tr.manualVentsAtEntry) {
      tr.phase = 'idle';
      return false;
    }
    if (v.heatRatio < 0.8) {
      tr.phase = 'idle';
      return true;
    }
    return false;
  },
};

const SUSTAINED_CONDITIONS = {
  repulsion_60ticks: (v) => !v.meltdown && v.failure?.failureState === 'repulsion' && (v.failure?.hullIntegrity ?? 100) > 0,
  heat_95pct_120ticks: (v) => !v.meltdown && v.heatRatio >= 0.95,
  max_heat_power_500k_10ticks: (v) => !v.meltdown && !v.paused && v.heatRatio >= 1 && v.stats.power >= 500000,
};

export function createObjectiveSystem(manifest, { hooks } = {}) {
  const objectives = manifest.objectives || [];
  const chapterRanges = computeChapterRanges(objectives);
  const experimentalIds = new Set(
    (manifest.components || []).filter((c) => c.experimental).map((c) => c.id),
  );
  const baseMoney = manifest.economy?.baseMoney || 10;
  let currentIndex = 0;
  let completed = new Set();
  const sustained = { sustainedPower1k: 0, masterHighHeat: 0 };
  const flags = { soldPower: false, soldHeat: false };

  hooks?.on?.('game:sellPower', () => { flags.soldPower = true; });
  hooks?.on?.('game:ventHeat', () => { flags.soldHeat = true; });

  function chapterProgress(chapterIdx) {
    const range = chapterRanges[chapterIdx];
    if (!range) return { completed: false, percent: 0, text: 'Loading...' };
    let done = 0;
    let total = 0;
    for (let i = range.start; i < range.end; i++) {
      if (objectives[i]?.isChapterCompletion) continue;
      total++;
      if (completed.has(i)) done++;
    }
    return {
      completed: total > 0 && done >= total,
      percent: total > 0 ? Math.min(100, (done / total) * 100) : 0,
      text: `${done} / ${total} Objectives Complete`,
    };
  }

  function buildView(session, context = {}) {
    const grid = session.grid;
    const economy = session.systems?.economy;
    const upgrades = session.systems?.upgrades;
    const failure = context.failure ?? session.systems?.failure?.serialize?.() ?? session.systems?.failure;
    const meltdown = context.meltdown ?? context.hasMeltedDown
      ?? failure?.hasMeltedDown
      ?? session.engine?.meltdown
      ?? false;
    return {
      grid,
      economy,
      upgrades,
      paused: context.paused ?? !!session.paused,
      tickCount: context.tickCount ?? session.engine?.tickCount ?? 0,
      baseMoney,
      flags,
      experimentalIds,
      chapterProgress,
      stats: deriveReactorStats(grid, session.modifiers || {}, {
        autoSellPercent: upgrades?.getAutoSellPercent?.() ?? 0,
        prestigeMultiplier: economy?.getPrestigeMultiplier?.() ?? 1,
        mechanicsOverrides: session.mechanicsOverrides,
      }),
      sustained: {
        get: (key) => sustained[key] ?? 0,
        start: (key, tick) => { sustained[key] = tick; },
        reset: (key) => { sustained[key] = 0; },
      },
      ...context,
      meltdown: !!meltdown,
      hasMeltedDown: !!(context.hasMeltedDown ?? failure?.hasMeltedDown ?? meltdown),
      failure: failure || null,
    };
  }

  function evaluate(checkId, session, context = {}) {
    const checker = OBJECTIVE_CHECKS[checkId];
    if (!checker) return null;
    return checker(buildView(session, context));
  }

  function maxValidIndex() {
    const last = objectives[objectives.length - 1];
    if (last?.checkId === 'allObjectives') return Math.max(0, objectives.length - 2);
    return Math.max(0, objectives.length - 1);
  }

  return {
    get currentIndex() { return currentIndex; },
    get objectives() { return objectives; },
    setIndex(index) {
      const raw = typeof index === 'string' ? parseInt(index, 10) : Number(index);
      const idx = Number.isNaN(raw) ? 0 : Math.floor(raw);
      currentIndex = Math.max(0, Math.min(idx, maxValidIndex()));
    },
    markComplete(index) { completed.add(index); },
    isComplete(index) { return completed.has(index); },
    getCurrentObjective() { return objectives[currentIndex] || null; },
    getCurrentProgress(session, context = {}) {
      const objective = objectives[currentIndex];
      if (!objective) return { completed: false, percent: 0, text: '' };
      if (completed.has(currentIndex)) return { completed: true, percent: 100, text: '' };
      return evaluate(objective.checkId, session, context) || { completed: false, percent: 0, text: 'Awaiting completion...' };
    },
    checkCurrent(session, context = {}) {
      const objective = objectives[currentIndex];
      if (!objective) return false;
      if (objective.checkId === 'allObjectives') return false;
      if (completed.has(currentIndex)) return false;
      const result = evaluate(objective.checkId, session, context);
      if (!result?.completed) return false;
      completed.add(currentIndex);
      session.events?.emit('objectiveComplete', { index: currentIndex, objective });
      return true;
    },

    claimCurrent() {
      if (!completed.has(currentIndex)) return false;
      if (currentIndex < objectives.length - 1) currentIndex++;
      return true;
    },

    setFlags(patch) {
      if (!patch) return;
      if (patch.soldPower != null) flags.soldPower = !!patch.soldPower;
      if (patch.soldHeat != null) flags.soldHeat = !!patch.soldHeat;
    },
    serialize() {
      return { currentIndex, completed: [...completed], flags: { ...flags }, sustained: { ...sustained } };
    },
    deserialize(data) {
      if (!data) return;
      currentIndex = data.currentIndex ?? currentIndex;
      completed = new Set(data.completed ?? []);
      if (data.flags) {
        flags.soldPower = !!data.flags.soldPower;
        flags.soldHeat = !!data.flags.soldHeat;
      }
      if (data.sustained) {
        sustained.sustainedPower1k = data.sustained.sustainedPower1k ?? 0;
        sustained.masterHighHeat = data.sustained.masterHighHeat ?? 0;
      }
    },
  };
}

function computeChapterRanges(objectives) {
  const ranges = [];
  let start = 0;
  objectives.forEach((objective, index) => {
    if (objective.isChapterCompletion) {
      ranges.push({ start, end: index });
      start = index + 1;
    }
  });
  return ranges;
}

export function createRevivalAchievements(manifest, { hooks } = {}) {
  const depletableIds = new Set(
    (manifest.components || []).filter((c) => (c.baseTicks || 0) > 0).map((c) => c.id),
  );
  let manualVents = 0;
  let lastMeltdown = false;
  let lastSnapshot = { activeCells: 0, powerProduced: 0, heatDissipated: 0 };
  const trackers = {};

  const achievements = createAchievementSystem(manifest, {
    hooks,
    instantChecks: INSTANT_CONDITIONS,
    sustainedChecks: SUSTAINED_CONDITIONS,
    thresholds: TICK_CHECK_THRESHOLDS,
    buildView({ ctx, tracker }) {
      const grid = ctx.grid;
      const destroyed = ctx.result.destroyedComponents || [];
      const explosions = destroyed.filter((d) => !depletableIds.has(d.id)).length;
      return {
        grid,
        upgrades: ctx.upgrades,
        failure: ctx.failure,
        paused: !!ctx.session?.paused,
        meltdown: !!ctx.result.meltdown,
        heatRatio: grid.maxHeat > 0 ? grid.currentHeat / grid.maxHeat : 0,
        ventCount: grid.countCategory('vent'),
        tickExplosions: explosions,
        manualVents,
        stats: deriveReactorStats(grid, ctx.session?.modifiers || {}),
        tracker: (checkId) => {
          if (!trackers[checkId]) trackers[checkId] = {};
          return trackers[checkId];
        },
      };
    },
  });

  hooks?.on?.('game:ventHeat', () => { manualVents++; });

  hooks?.on?.('game:reboot', () => {
    achievements.unlockByEvent('prestigeCompleted', (id) => {
      if (id === 'ach_nuclear_disarmament') return lastSnapshot.activeCells === 1;
      if (id === 'ach_perfect_weave') {
        const p = lastSnapshot.powerProduced;
        const h = lastSnapshot.heatDissipated;
        return p > 0 && h > 0 && Math.abs(p - h) / Math.max(p, h) <= 0.001;
      }
      return true;
    });
  });

  const onBlueprint = (payload) => {
    const netHeat = payload?.netHeat;
    const power = payload?.power;
    if (netHeat != null || power != null) {
      if ((netHeat ?? 0) <= 0 && (power ?? 0) > 0) achievements.unlockByEvent('blueprintPlannerChanged');
      return;
    }
    achievements.unlockByEvent('blueprintPlannerChanged');
  };
  hooks?.on?.('game:blueprintPlannerChanged', onBlueprint);
  hooks?.on?.('game:blueprintPlannerCommitted', onBlueprint);

  const baseEvaluate = achievements.evaluate.bind(achievements);
  achievements.evaluate = (ctx) => {
    if (ctx.result.meltdown && !lastMeltdown) achievements.unlockByEvent('meltdownStarted');
    lastMeltdown = !!ctx.result.meltdown;
    const destroyed = ctx.result.destroyedComponents || [];
    const explosions = destroyed.filter((d) => !depletableIds.has(d.id)).length;
    if (explosions > 0) achievements.unlockByEvent('component_explosion');
    baseEvaluate(ctx);
    let activeCells = 0;
    ctx.grid.forEach((_, __, inst) => {
      if (inst?.definition?.category === 'cell' && inst.ticks > 0) activeCells++;
    });
    lastSnapshot = {
      activeCells,
      powerProduced: toNum(ctx.economy?.sessionPowerProduced),
      heatDissipated: toNum(ctx.economy?.sessionHeatDissipated),
    };
  };

  return achievements;
}

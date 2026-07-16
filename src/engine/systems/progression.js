import { createSustainedTracker } from '../kernel/gridUtils.js';

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

export function createObjectiveSystem(manifest, { hooks, checks, buildView, onComplete } = {}) {
  const objectives = manifest.objectives || [];
  const chapterRanges = computeChapterRanges(objectives);
  let currentIndex = 0;
  let completed = new Set();
  const sustained = createSustainedTracker();
  const flags = {};

  hooks?.on?.('game:sellPower', () => { flags.soldPower = true; });
  hooks?.on?.('game:ventHeat', (payload) => {
    if (payload?.remaining == null || payload.remaining <= 0.001) flags.soldHeat = true;
  });
  hooks?.on?.('game:soldHeat', () => { flags.soldHeat = true; });

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

  function resolveView(session, context = {}) {
    const base = buildView
      ? buildView({ session, flags, sustained, chapterProgress, context })
      : { session, flags, sustained, chapterProgress };
    const failure = context.failure ?? session.systems?.failure?.serialize?.() ?? session.systems?.failure;
    const meltdown = context.meltdown ?? context.hasMeltedDown
      ?? failure?.hasMeltedDown
      ?? session.engine?.meltdown
      ?? false;
    return {
      ...base,
      ...context,
      meltdown: !!meltdown,
      hasMeltedDown: !!(context.hasMeltedDown ?? failure?.hasMeltedDown ?? meltdown),
      failure: failure || base.failure || null,
    };
  }

  function evaluate(checkId, session, context = {}) {
    const checker = checks?.[checkId];
    if (!checker) return null;
    return checker(resolveView(session, context));
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

    markComplete(index) {
      completed.add(index);
    },

    isComplete(index) {
      return completed.has(index);
    },

    getCurrentObjective() {
      return objectives[currentIndex] || null;
    },

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
      onComplete?.({ session, index: currentIndex, objective });
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
      return {
        currentIndex,
        completed: [...completed],
        flags: { ...flags },
        sustained: sustained.serialize(),
      };
    },

    deserialize(data) {
      if (!data) return;
      currentIndex = data.currentIndex ?? currentIndex;
      completed = new Set(data.completed ?? []);
      if (data.flags) Object.assign(flags, data.flags);
      sustained.deserialize(data.sustained);
    },
  };
}

export function createAchievementSystem(manifest, { hooks, instantChecks = {}, sustainedChecks = {}, thresholds = {}, buildView, onUnlock, beforeEvaluate } = {}) {
  const achievements = manifest.achievements || [];
  const tickAchievements = achievements.filter((a) => a.triggerType === 'tick' && a.checkId);
  const eventAchievements = new Map();
  for (const a of achievements) {
    if (a.triggerType !== 'event' || !a.triggerEvent) continue;
    if (!eventAchievements.has(a.triggerEvent)) eventAchievements.set(a.triggerEvent, []);
    eventAchievements.get(a.triggerEvent).push(a.id);
  }

  const unlocked = new Set();
  const trackers = {};
  const sustained = createSustainedTracker();
  let sessionRef = null;
  let pendingUnlockIds = null;

  function tracker(checkId) {
    if (!trackers[checkId]) trackers[checkId] = {};
    return trackers[checkId];
  }

  function syncSession() {
    if (sessionRef) sessionRef.achievements = [...unlocked];
  }

  function emitUnlock(id) {
    sessionRef?.events?.emit('achievementUnlocked', { id });
    sessionRef?.events?.emit('ACHIEVEMENT_UNLOCKED', { id });
  }

  function unlock(id) {
    if (unlocked.has(id)) return false;
    unlocked.add(id);
    syncSession();
    pendingUnlockIds?.push(id);
    onUnlock?.({ session: sessionRef, id });
    emitUnlock(id);
    return true;
  }

  function unlockByEvent(eventName, filter = null) {
    for (const id of eventAchievements.get(eventName) || []) {
      if (!filter || filter(id)) unlock(id);
    }
  }

  function evaluateTickCheck(view, checkId) {
    if (instantChecks[checkId]) return instantChecks[checkId](view, tracker(checkId));
    const sustainedFn = sustainedChecks[checkId];
    const threshold = thresholds[checkId];
    if (!sustainedFn || threshold == null) return false;
    const active = sustainedFn(view);
    return sustained.track(checkId, active, threshold).completed;
  }

  return {
    get unlocked() { return unlocked },
    isUnlocked(id) { return unlocked.has(id); },
    unlock,
    unlockByEvent,
    registerEventHooks(eventHooks = {}) {
      for (const [eventName, handler] of Object.entries(eventHooks)) {
        hooks?.on?.(`game:${eventName}`, (...args) => handler({ unlockByEvent, unlock, session: sessionRef }, ...args));
      }
    },
    evaluate(ctx) {
      if (ctx.session) sessionRef = ctx.session;
      pendingUnlockIds = [];
      beforeEvaluate?.({ ctx, unlockByEvent, unlock });
      const view = buildView?.({ ctx, tracker, unlockByEvent }) ?? { ctx };
      for (const achievement of tickAchievements) {
        if (unlocked.has(achievement.id)) continue;
        if (evaluateTickCheck(view, achievement.checkId)) unlock(achievement.id);
      }
      if (ctx.result) {
        ctx.result.unlockedAchievementIds = Object.freeze([...pendingUnlockIds]);
      }
      const unlockedIds = pendingUnlockIds;
      pendingUnlockIds = null;
      syncSession();
      return unlockedIds;
    },
    serialize() {
      return {
        unlocked: [...unlocked],
        trackers: JSON.parse(JSON.stringify(trackers)),
        sustained: sustained.serialize(),
      };
    },
    deserialize(data) {
      unlocked.clear();
      for (const key of Object.keys(trackers)) delete trackers[key];
      sustained.reset();
      if (Array.isArray(data)) {
        for (const id of data) unlocked.add(id);
      } else if (data && typeof data === 'object') {
        for (const id of data.unlocked || []) unlocked.add(id);
        if (data.trackers && typeof data.trackers === 'object') {
          for (const [key, value] of Object.entries(data.trackers)) trackers[key] = value;
        }
        sustained.deserialize(data.sustained);
      }
      syncSession();
    },
  };
}

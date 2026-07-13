const PERCENT_MAX = 100;
const SUSTAINED_TICKS_REQUIRED = 30;
const SUSTAINED_POWER_THRESHOLD = 1000;
const HEAT_10M = 1e7;
const FIRST_BILLION = 1e9;
const MONEY_10B = 1e10;
const CELLS_TARGET_5 = 5;
const CELLS_TARGET_10 = 10;
const POWER_TARGET_200 = 200;
const POWER_TARGET_500 = 500;
const POWER_TARGET_10K = 10000;
const INCOME_TARGET_50K = 50000;

export function toNum(value) {
  if (value == null) return 0;
  if (typeof value.toNumber === 'function') return value.toNumber();
  return Number(value) || 0;
}

function progressWithCap(current, target) {
  return Math.min(PERCENT_MAX, (current / target) * PERCENT_MAX);
}

function createProgress(current, target, unit = '', textOverride = null) {
  const percent = target > 0 ? progressWithCap(current, target) : (current > 0 ? PERCENT_MAX : 0);
  return {
    completed: current >= target,
    percent,
    text: textOverride || `${current.toLocaleString()} / ${target.toLocaleString()} ${unit}`.trim(),
  };
}

function boolProgress(done, doneText, pendingText) {
  return { completed: !!done, percent: done ? PERCENT_MAX : 0, text: done ? doneText : pendingText };
}

function countById(grid, id, activeOnly = false) {
  let count = 0;
  grid.forEach((_, __, inst) => {
    if (inst?.definition?.id === id && (!activeOnly || inst.ticks > 0)) count++;
  });
  return count;
}

function countActiveCells(grid) {
  let count = 0;
  grid.forEach((_, __, inst) => {
    if (inst?.definition?.category === 'cell' && inst.ticks > 0) count++;
  });
  return count;
}

function hasVentNextToCell(grid) {
  let found = false;
  grid.forEach((row, col, inst) => {
    if (found || !inst || inst.definition.category !== 'cell' || inst.ticks <= 0) return;
    const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of offsets) {
      if (grid.getComponentAt(row + dr, col + dc)?.definition?.category === 'vent') {
        found = true;
        return;
      }
    }
  });
  return found;
}

function sustainedCheck(view, key, active, targetTicks, activeText, idleText) {
  const tickCount = view.tickCount;
  if (active && !view.paused) {
    if (view.sustained.get(key) === 0) view.sustained.start(key, tickCount);
    const elapsed = tickCount - view.sustained.get(key);
    return createProgress(elapsed, targetTicks, '', `${elapsed} / ${targetTicks} ticks steady`);
  }
  view.sustained.reset(key);
  return { completed: false, percent: 0, text: idleText };
}

function epCheck(view, target) {
  const ep = toNum(view.economy?.currentExoticParticles);
  return {
    completed: ep >= target,
    percent: progressWithCap(ep, target),
    text: `${ep.toLocaleString()} / ${target.toLocaleString()} EP Generated`,
  };
}

function moneyCheck(view, target) {
  const money = toNum(view.economy?.money);
  return {
    completed: money >= target,
    percent: progressWithCap(money, target),
    text: `$${money.toLocaleString()} / $${target.toLocaleString()}`,
  };
}

function powerCheck(view, target) {
  const power = view.stats?.power || 0;
  const result = createProgress(power, target, 'Power');
  result.completed = power >= target && !view.paused;
  return result;
}

function quadCellCheck(view, id, label) {
  return createProgress(countById(view.grid, id, true), CELLS_TARGET_5, label);
}

function purchasedLevels(view) {
  return view.upgrades?.serialize?.() || [];
}

export const OBJECTIVE_CHECKS = {
  firstCell(view) {
    const done = view.grid.countComponents() > 0;
    return boolProgress(done, '1 / 1 Cell Placed', '0 / 1 Cell Placed');
  },
  sellPower(view) {
    const power = view.grid.currentPower || 0;
    return boolProgress(view.flags.soldPower, 'Power sold!', power > 0 ? 'Power available to sell' : 'No power to sell');
  },
  reduceHeat(view) {
    const heat = Math.round(view.grid.currentHeat || 0);
    return boolProgress(view.flags.soldHeat, `${heat.toLocaleString()} / 0 Heat`, `${heat.toLocaleString()} / 0 Heat`);
  },
  ventNextToCell(view) {
    return boolProgress(hasVentNextToCell(view.grid), 'Vent placed next to Cell', 'Place a Vent next to a Cell');
  },
  purchaseUpgrade(view) {
    const done = purchasedLevels(view).some((entry) => entry.level > 0);
    return boolProgress(done, 'Upgrade purchased!', 'Purchase an upgrade');
  },
  purchaseDualCell(view) {
    return boolProgress(view.grid.hasComponentId('uranium2'), 'Dual Cell placed!', 'Place a Dual Cell');
  },
  tenActiveCells(view) {
    return createProgress(countActiveCells(view.grid), CELLS_TARGET_10, 'Cells');
  },
  perpetualUranium(view) {
    const done = (view.upgrades?.getLevel('uranium1_cell_perpetual') || 0) > 0
      || (view.upgrades?.getLevel('perpetual_uranium') || 0) > 0;
    return boolProgress(done, 'Perpetual Uranium unlocked!', 'Unlock Perpetual Uranium');
  },
  increaseMaxPower(view) {
    return boolProgress(view.grid.countCategory('capacitor') > 0, 'Capacitor placed!', 'Place a Capacitor');
  },
  fiveComponentKinds(view) {
    const categories = new Set();
    view.grid.forEach((_, __, inst) => {
      if (inst?.definition?.category) categories.add(inst.definition.category);
    });
    return createProgress(categories.size, CELLS_TARGET_5, 'Component types');
  },
  tenCapacitors(view) {
    return createProgress(view.grid.countCategory('capacitor'), CELLS_TARGET_10, 'Capacitors');
  },
  fiveQuadPlutonium(view) {
    return quadCellCheck(view, 'plutonium3', 'Quad Plutonium Cells');
  },
  unlockThorium(view) {
    return quadCellCheck(view, 'thorium3', 'Quad Thorium Cells');
  },
  unlockSeaborgium(view) {
    return quadCellCheck(view, 'seaborgium3', 'Quad Seaborgium Cells');
  },
  fiveQuadDolorium(view) {
    return quadCellCheck(view, 'dolorium3', 'Quad Dolorium Cells');
  },
  fiveQuadNefastium(view) {
    return quadCellCheck(view, 'nefastium3', 'Quad Nefastium Cells');
  },
  placeExperimentalPart(view) {
    let done = false;
    view.grid.forEach((_, __, inst) => {
      if (inst && view.experimentalIds.has(inst.definition.id)) done = true;
    });
    return boolProgress(done, 'Experimental part placed!', 'Place an experimental part');
  },
  powerPerTick200(view) {
    return powerCheck(view, POWER_TARGET_200);
  },
  powerPerTick500(view) {
    return powerCheck(view, POWER_TARGET_500);
  },
  powerPerTick10k(view) {
    return powerCheck(view, POWER_TARGET_10K);
  },
  improvedChronometers(view) {
    const done = (view.upgrades?.getLevel('chronometer') || 0) > 0;
    return boolProgress(done, 'Chronometer unlocked!', 'Unlock Chronometer');
  },
  potentUranium3(view) {
    return createProgress(view.upgrades?.getLevel('uranium1_cell_power') || 0, 3, 'levels');
  },
  autoSell500(view) {
    return createProgress(Math.floor(view.economy?.lastTickAutoSold || 0), POWER_TARGET_500, '$/tick');
  },
  sustainedPower1k(view) {
    const power = view.stats?.power || 0;
    const result = sustainedCheck(
      view, 'sustainedPower1k', power >= SUSTAINED_POWER_THRESHOLD, SUSTAINED_TICKS_REQUIRED,
      '', `${power.toLocaleString()} / 1,000 Power (hold ${SUSTAINED_TICKS_REQUIRED} ticks)`,
    );
    return result;
  },
  infrastructureUpgrade1(view) {
    const capacitors = countById(view.grid, 'capacitor2');
    const vents = countById(view.grid, 'vent2');
    const total = Math.min(capacitors, CELLS_TARGET_10) + Math.min(vents, CELLS_TARGET_10);
    return createProgress(total, CELLS_TARGET_10 * 2, '', `${capacitors}/10 Capacitors, ${vents}/10 Vents`);
  },
  incomeMilestone50k(view) {
    const income = Math.floor(view.economy?.lastTickIncome || 0);
    return createProgress(income, INCOME_TARGET_50K, '', `$${income.toLocaleString()} / $50,000 per tick`);
  },
  firstBillion(view) {
    return moneyCheck(view, FIRST_BILLION);
  },
  money10B(view) {
    return moneyCheck(view, MONEY_10B);
  },
  masterHighHeat(view) {
    const heat = Math.round(view.grid.currentHeat || 0);
    const active = heat > HEAT_10M && !view.meltdown;
    const result = sustainedCheck(
      view, 'masterHighHeat', active, SUSTAINED_TICKS_REQUIRED,
      '', `${heat.toLocaleString()} / 10,000,000 Heat`,
    );
    if (!result.completed && !active) result.percent = progressWithCap(heat, HEAT_10M);
    return result;
  },
  ep10(view) { return epCheck(view, 10); },
  ep51(view) { return epCheck(view, 51); },
  ep250(view) { return epCheck(view, 250); },
  ep1000(view) { return epCheck(view, 1000); },
  investInResearch1(view) {
    const count = ((view.upgrades?.getLevel('infused_cells') || 0) > 0 ? 1 : 0)
      + ((view.upgrades?.getLevel('unleashed_cells') || 0) > 0 ? 1 : 0);
    return createProgress(count, 2, 'upgrades');
  },
  reboot(view) {
    const economy = view.economy;
    const done = toNum(economy?.totalExoticParticles) > 0
      && toNum(economy?.money) < view.baseMoney * 2
      && toNum(economy?.currentExoticParticles) === 0;
    return boolProgress(done, 'Reboot complete!', 'Perform a reboot');
  },
  experimentalUpgrade(view) {
    const done = purchasedLevels(view).some((entry) => {
      if (entry.level <= 0) return false;
      const def = view.upgrades?.getDefinition?.(entry.id);
      const type = def?.type || '';
      return type.startsWith('experimental_') && type !== 'experimental_laboratory';
    });
    return boolProgress(done, 'Experimental upgrade purchased!', 'Purchase an experimental upgrade');
  },
  completeChapter1(view) { return view.chapterProgress(0); },
  completeChapter2(view) { return view.chapterProgress(1); },
  completeChapter3(view) { return view.chapterProgress(2); },
  completeChapter4(view) { return view.chapterProgress(3); },
  allObjectives() {
    return { completed: true, percent: PERCENT_MAX, text: 'All objectives completed!' };
  },
};

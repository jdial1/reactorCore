import { createSaveCodec } from '../../engine/systems/save.js';
import { toNum } from '../../engine/kernel/gridUtils.js';

function decodeCompactTiles(session, legacy) {
  const { tiles_compact: compact, part_table: partTable, cols } = legacy;
  if (!compact || !partTable) return;
  session.grid.clearGrid();
  const stride = cols;
  for (let i = 0; i < compact.length; i++) {
    const entry = compact[i];
    if (!entry) continue;
    const partIndex = entry.partIndex ?? entry.p;
    const partId = partTable[partIndex];
    if (!partId) continue;
    const row = Math.floor(i / stride);
    const col = i % stride;
    session.placeComponent(row, col, partId);
    const inst = session.grid.getComponentAt(row, col);
    if (inst) {
      if (entry.heat != null) inst.currentHeat = entry.heat;
      if (entry.ticks != null) inst.ticks = entry.ticks;
    }
  }
}

export function decodeLegacySave(session, legacy) {
  if (!legacy) throw new Error('Invalid legacy save');
  const economy = session.systems.economy;
  if (economy) {
    economy.deserialize({
      money: legacy.current_money,
      currentExoticParticles: legacy.current_exotic_particles ?? legacy.exotic_particles,
      totalExoticParticles: legacy.total_exotic_particles,
      sessionPowerProduced: legacy.session_power_produced,
      sessionPowerSold: legacy.session_power_sold,
      sessionHeatDissipated: legacy.session_heat_dissipated,
      soldPower: legacy.sold_power,
      soldHeat: legacy.sold_heat,
      protiumParticles: legacy.protium_particles,
    });
  }
  if (legacy.upgrades && session.systems.upgrades) {
    session.systems.upgrades.deserialize(legacy.upgrades.map((u) => ({ id: u.id, level: u.level })));
  }
  if (legacy.objectives) {
    session.systems.objectives?.setIndex?.(legacy.objectives.current_objective_index ?? 0);
    const completed = legacy.objectives.completed_objectives;
    if (Array.isArray(completed)) {
      completed.forEach((done, idx) => { if (done) session.systems.objectives?.markComplete?.(idx); });
    }
  }
  session.systems.objectives?.setFlags?.({
    soldPower: !!legacy.sold_power,
    soldHeat: !!legacy.sold_heat,
  });
  if (legacy.rows && legacy.cols) session.grid.resize(legacy.rows, legacy.cols);
  if (legacy.reactor) {
    session.grid.currentHeat = toNum(legacy.reactor.current_heat);
    session.grid.currentPower = toNum(legacy.reactor.current_power);
    session.grid.maxHeat = legacy.reactor.base_max_heat ?? session.grid.maxHeat;
    session.grid.maxPower = legacy.reactor.base_max_power ?? session.grid.maxPower;
    if (legacy.reactor.has_melted_down) {
      session.systems.failure?.deserialize?.({ hasMeltedDown: true, failureState: 'criticality' });
    }
  }
  if (legacy.tiles?.length) {
    session.grid.clearGrid();
    for (const tile of legacy.tiles) {
      if (tile.partId) session.placeComponent(tile.row, tile.col, tile.partId);
      const inst = session.grid.getComponentAt(tile.row, tile.col);
      if (inst && tile.heat != null) inst.currentHeat = toNum(tile.heat);
      if (inst && tile.heat_contained != null) inst.currentHeat = toNum(tile.heat_contained);
      const ticks = tile.ticks_left ?? tile.ticks;
      if (inst && ticks != null) inst.ticks = ticks;
    }
  } else if (legacy.tiles_compact) {
    decodeCompactTiles(session, legacy);
  }
  const pause = legacy.pause ?? legacy.toggles?.pause ?? false;
  session.toggles = {
    pause,
    auto_sell: legacy.auto_sell ?? legacy.toggles?.auto_sell ?? false,
    auto_buy: legacy.auto_buy ?? legacy.toggles?.auto_buy ?? false,
    heat_control: legacy.heat_control ?? legacy.toggles?.heat_control ?? false,
    time_flux: legacy.time_flux ?? legacy.toggles?.time_flux ?? true,
  };
  session.setPaused(pause);
  session.baseRows = legacy.base_rows ?? session.grid.rows;
  session.baseCols = legacy.base_cols ?? session.grid.cols;
  session.runId = legacy.run_id ?? session.runId;
  session.techTree = legacy.tech_tree ?? 'unified';
  session.totalPlayedTime = legacy.total_played_time ?? session.totalPlayedTime ?? 0;
  session.lastSaveTime = legacy.last_save_time ?? session.lastSaveTime ?? Date.now();
  session.achievements = legacy.unlocked_achievements ?? session.achievements ?? [];
  session.systems.achievements?.deserialize?.(session.achievements);
  session.placedCounts = legacy.placedCounts ?? session.placedCounts ?? {};
  session.systems.failure?.setGracePeriodTicks?.(legacy.grace_period_ticks ?? 0);
  session.recompileModifiers?.();
  return session;
}

function serializeExtra(session) {
  const gridSnap = session.grid.getSnapshot();
  const objectivesData = session.systems.objectives?.serialize?.();
  const achievementsData = session.systems.achievements?.serialize?.() ?? session.achievements ?? [];
  const unlockedIds = Array.isArray(achievementsData)
    ? achievementsData
    : (achievementsData?.unlocked ?? []);
  return {
    saveVersion: session.manifest.saveVersion ?? 2,
    failure: session.systems.failure?.serialize?.(),
    objectives: objectivesData,
    objectivesCompleted: objectivesData?.completed ?? [],
    toggles: session.toggles ?? {},
    rows: session.grid.rows,
    cols: session.grid.cols,
    baseRows: session.baseRows ?? session.grid.rows,
    baseCols: session.baseCols ?? session.grid.cols,
    runId: session.runId ?? null,
    techTree: session.techTree ?? 'unified',
    gracePeriodTicks: session.systems.failure?.gracePeriodTicks ?? 0,
    achievements: achievementsData,
    unlocked_achievements: unlockedIds,
    total_played_time: session.totalPlayedTime ?? 0,
    last_save_time: session.lastSaveTime ?? Date.now(),
    tileHeat: gridSnap.tileHeat ?? null,
    activated: gridSnap.tileHeat?.activated ?? null,
    placedCounts: session.placedCounts ?? {},
  };
}

function deserializeExtra(session, data) {
  session.systems.failure?.deserialize?.(data.failure);
  session.systems.objectives?.deserialize?.(data.objectives);
  if (data.toggles) session.toggles = { ...session.toggles, ...data.toggles };
  if (data.runId != null) session.runId = data.runId;
  if (data.techTree) session.techTree = data.techTree;
  if (data.gracePeriodTicks != null) session.systems.failure?.setGracePeriodTicks?.(data.gracePeriodTicks);
  const achievementsRaw = data.achievements ?? data.unlocked_achievements;
  session.systems.achievements?.deserialize?.(achievementsRaw);
  const unlockedIds = Array.isArray(achievementsRaw)
    ? achievementsRaw
    : (achievementsRaw?.unlocked ?? []);
  session.achievements = [...unlockedIds];
  if (data.total_played_time != null) session.totalPlayedTime = data.total_played_time;
  if (data.last_save_time != null) session.lastSaveTime = data.last_save_time;
  if (data.placedCounts) session.placedCounts = { ...data.placedCounts };
  if (data.tileHeat && session.grid.tileHeatMap) session.grid.tileHeatMap.deserialize(data.tileHeat);
  else if (data.activated && session.grid.tileHeatMap) session.grid.tileHeatMap.deserialize({ activated: data.activated });
  if (data.objectivesCompleted?.length && session.systems.objectives) {
    for (const idx of data.objectivesCompleted) session.systems.objectives.markComplete(idx);
  }
}

export function createRevivalSaveCodec(manifest) {
  return createSaveCodec({
    saveVersion: manifest.saveVersion ?? 2,
    serializeExtra,
    deserializeExtra,
    decodeLegacy: decodeLegacySave,
    canLoad: (data) => data?.saveVersion >= (manifest.saveVersion ?? 2),
  });
}

export const serializeRevivalSession = (session) => createRevivalSaveCodec(session.manifest).serialize(session);
export const deserializeRevivalSession = (session, data) => createRevivalSaveCodec(session.manifest).deserialize(session, data);

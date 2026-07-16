import { toNum } from '../kernel/gridUtils.js';
import { toDecimal, toNumber, getDecimalCtor } from './decimal.js';

const DEFAULT_SELL_MULTIPLIER = 0.5;

export function clipToGrid(layout, rows, cols) {
  return layout.slice(0, rows).map((row) => (row || []).slice(0, cols));
}

export function gridToLayout(session) {
  const { grid } = session;
  const layout = Array.from({ length: grid.rows }, () => Array.from({ length: grid.cols }, () => null));
  grid.forEach((r, c, inst) => {
    if (!inst) return;
    layout[r][c] = { id: inst.definition.id, t: inst.definition.type, lvl: inst.definition.level || 1 };
  });
  return layout;
}

export function layoutFromPlannerSlots(session, slots) {
  const plannerSlots = slots ?? session.blueprintPlanner?.slots;
  if (!plannerSlots || typeof plannerSlots !== 'object') return null;
  const layout = gridToLayout(session);
  for (const key of Object.keys(plannerSlots)) {
    const partId = plannerSlots[key];
    if (!partId) continue;
    const [rs, cs] = key.split(',');
    const r = Number(rs);
    const c = Number(cs);
    if (!Number.isFinite(r) || !Number.isFinite(c) || r < 0 || c < 0 || r >= session.grid.rows || c >= session.grid.cols) continue;
    const def = session.registry.get?.(partId) || session.manifest.components?.find((component) => component.id === partId);
    if (!def) continue;
    layout[r][c] = { id: def.id, t: def.type, lvl: def.level || 1 };
  }
  return layout;
}

function partUsesEp(def) {
  return !!(def.erequires || def.currency === 'ep' || def.ecost != null);
}

function partCostForCell(def, cell, policy = {}) {
  if (!def) return { money: 0, ep: 0 };
  if (policy.partCostForCell) return policy.partCostForCell(def, cell);
  const level = cell?.lvl || def.level || 1;
  const base = def.baseCost || 0;
  let n;
  if (getDecimalCtor()) {
    n = toNumber(toDecimal(base).mul(level));
  } else {
    n = base * level;
  }
  if (partUsesEp(def)) return { money: 0, ep: n };
  return { money: n, ep: 0 };
}

function cellsMatch(inst, cell) {
  if (!cell?.id) return !inst;
  if (!inst) return false;
  const def = inst.definition;
  return def.id === cell.id && (def.level || 1) === (cell.lvl || 1);
}

export function computeBlueprintDiff(session, targetLayout, policy = {}) {
  const { grid, registry } = session;
  if (!targetLayout) {
    return { toRemove: [], toPlace: [], unchanged: [], breakdown: { money: 0, ep: 0 } };
  }
  const clipped = clipToGrid(targetLayout, grid.rows, grid.cols);
  const toRemove = [];
  const toPlace = [];
  const unchanged = [];
  const breakdown = { money: 0, ep: 0 };

  for (let r = 0; r < clipped.length; r++) {
    const row = clipped[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      const inst = grid.getComponentAt(r, c);
      if (cellsMatch(inst, cell)) {
        unchanged.push({ r, c, cell });
        continue;
      }
      if (inst) toRemove.push({ r, c, inst });
      if (cell?.id) {
        const def = registry.get?.(cell.id);
        if (def) {
          toPlace.push({ r, c, cell, def });
          const cost = partCostForCell(def, cell, policy);
          breakdown.money += cost.money;
          breakdown.ep += cost.ep;
        }
      }
    }
  }
  return { toRemove, toPlace, unchanged, breakdown };
}

export function computeBlueprintCostBreakdown(session, targetLayout, policy = {}) {
  return computeBlueprintDiff(session, targetLayout, policy).breakdown;
}

function checkAffordability(session, breakdown, sellCredit = 0) {
  const economy = session.systems.economy;
  if (!economy) return null;
  const netMoney = breakdown.money - sellCredit;
  const money = toNum(economy.money);
  const ep = toNum(economy.currentExoticParticles);
  const moneyShort = netMoney > money ? netMoney - money : 0;
  const epShort = breakdown.ep > ep ? breakdown.ep - ep : 0;
  if (moneyShort > 0 || epShort > 0) return { moneyShort, epShort };
  return null;
}

function filterAffordablePlacements(session, placements, sellCredit = 0, policy = {}) {
  const economy = session.systems.economy;
  let money = toNum(economy?.money) + sellCredit;
  let ep = toNum(economy?.currentExoticParticles);
  const affordable = [];
  for (let i = 0; i < placements.length; i++) {
    const entry = placements[i];
    const cost = partCostForCell(entry.def, entry.cell, policy);
    if (cost.ep > 0) {
      if (ep < cost.ep) continue;
      ep -= cost.ep;
    } else if (cost.money > 0) {
      if (money < cost.money) continue;
      money -= cost.money;
    }
    affordable.push(entry);
  }
  return affordable;
}

function debitLayoutCost(session, breakdown) {
  const economy = session.systems.economy;
  if (!economy) return false;
  if (breakdown.money > 0 && !economy.spendMoney(breakdown.money)) return false;
  if (breakdown.ep > 0 && !economy.spendExoticParticles?.(breakdown.ep)) return false;
  return true;
}

export function sellAllComponents(session, sellMultiplier = DEFAULT_SELL_MULTIPLIER) {
  const { grid } = session;
  const sold = [];
  grid.forEach((r, c, inst) => {
    if (!inst) return;
    const value = Math.floor((inst.definition.baseCost || 0) * (inst.definition.level || 1) * sellMultiplier);
    session.removeComponent(r, c);
    if (value > 0) session.systems.economy?.addMoney(value);
    sold.push({ r, c, value });
  });
  return sold;
}

export function applyBlueprintLayoutDiff(session, targetLayout, options = {}, policy = {}) {
  if (!session?.grid || !targetLayout) return { ok: false, reason: 'invalid' };
  const diff = computeBlueprintDiff(session, targetLayout, policy);
  let placements = diff.toPlace;
  const sellCredit = options.sellCredit ?? 0;

  if (options.partial) {
    placements = filterAffordablePlacements(session, placements, sellCredit, policy);
    if (placements.length === 0 && diff.toPlace.length > 0) {
      return { ok: false, reason: 'deficit', breakdown: diff.breakdown };
    }
  } else if (!options.skipCostDeduction) {
    const deficit = checkAffordability(session, diff.breakdown, sellCredit);
    if (deficit) return { ok: false, reason: 'deficit', ...deficit, breakdown: diff.breakdown };
  }

  const placeKeys = new Set(placements.map((p) => `${p.r},${p.c}`));
  const clipped = clipToGrid(targetLayout, session.grid.rows, session.grid.cols);
  for (let i = 0; i < diff.toRemove.length; i++) {
    const { r, c } = diff.toRemove[i];
    const key = `${r},${c}`;
    const targetCell = clipped[r]?.[c];
    const clearingToEmpty = !targetCell?.id;
    if (clearingToEmpty || placeKeys.has(key)) session.removeComponent(r, c);
  }
  for (let i = 0; i < placements.length; i++) {
    const { r, c, cell } = placements[i];
    session.removeComponent(r, c);
    session.placeComponent(r, c, cell.id);
  }

  if (!options.skipCostDeduction) {
    const placeBreakdown = placements.reduce(
      (out, { def, cell }) => {
        const cost = partCostForCell(def, cell, policy);
        out.money += cost.money;
        out.ep += cost.ep;
        return out;
      },
      { money: 0, ep: 0 },
    );
    if (placeBreakdown.money > 0 || placeBreakdown.ep > 0) {
      if (!debitLayoutCost(session, placeBreakdown)) {
        return { ok: false, reason: 'deficit', breakdown: diff.breakdown };
      }
    }
  }

  session.grid.recalculateCaps();
  const stats = session.systems?.stats?.compute?.({
    grid: session.grid,
    modifiers: session.modifiers,
    upgrades: session.systems.upgrades,
    economy: session.systems.economy,
    mechanicsOverrides: session.mechanicsOverrides,
    toggles: session.toggles,
  });

  return {
    ok: true,
    placed: placements.length,
    removed: diff.toRemove.length,
    partial: !!options.partial,
    breakdown: diff.breakdown,
    netHeat: stats?.netHeat,
    power: stats?.power,
    maxPower: session.grid.maxPower,
    maxHeat: session.grid.maxHeat,
  };
}

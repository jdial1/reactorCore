import { createEffectRegistry, compileModifiersFromEntries } from './effect-registry.js';
import { getDecimalCtor, toDecimal, toNumber } from './decimal.js';

function toNum(value) {
  if (value == null) return 0;
  if (typeof value.toNumber === 'function') return value.toNumber();
  return Number(value) || 0;
}

function spendEp(economy, cost) {
  if (typeof economy.spendExoticParticles === 'function') return economy.spendExoticParticles(cost);
  if (toNum(economy.currentExoticParticles) < cost) return false;
  economy.currentExoticParticles -= cost;
  return true;
}

function normalizeErequires(erequires) {
  if (!erequires) return [];
  return Array.isArray(erequires) ? erequires : [erequires];
}

function computeCost(def, level) {
  if (!def) return Infinity;
  if (def.maxLevel != null && level >= def.maxLevel) return Infinity;
  const base = def.baseCost ?? def.cost ?? 0;
  const multiplier = def.costMultiplier ?? 2;
  if (getDecimalCtor()) {
    const d = toDecimal(base).mul(toDecimal(multiplier).pow(level));
    return typeof d.floor === 'function' ? d.floor() : toDecimal(Math.floor(toNumber(d)));
  }
  return Math.floor(base * Math.pow(multiplier, level));
}

export function createUpgradeStore(manifest, options = {}) {
  const levels = new Map();
  const upgradeDefs = manifest.upgrades || {};
  const effectRegistry = createEffectRegistry(options.effects);
  let canPurchaseExtra = options.canPurchaseExtra || null;

  function flattenUpgrades(obj) {
    const result = [];
    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object' && val.id) {
        result.push(val);
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        result.push(...flattenUpgrades(val));
      }
    }
    return result;
  }

  const allUpgrades = Array.isArray(upgradeDefs)
    ? upgradeDefs
    : flattenUpgrades(upgradeDefs);
  const upgradeMap = new Map(allUpgrades.map((u) => [u.id, u]));
  let cachedModifiers = null;

  const store = {
    getLevel: (id) => levels.get(id) || 0,
    getDefinition: (id) => upgradeMap.get(id) || null,
    getAllDefinitions: () => [...upgradeMap.values()],
    setCanPurchaseExtra: (fn) => { canPurchaseExtra = fn || null; },

    getCost(id) {
      return toNumber(computeCost(upgradeMap.get(id), store.getLevel(id)));
    },

    getCostDecimal(id) {
      return computeCost(upgradeMap.get(id), store.getLevel(id));
    },

    previewPurchase(id, economy = null, session = null) {
      const def = upgradeMap.get(id);
      if (!def) {
        return { ok: false, reason: 'unknown', id, canPurchase: false, cost: Infinity, currency: null };
      }
      const level = store.getLevel(id);
      const cost = store.getCost(id);
      const costDecimal = store.getCostDecimal(id);
      const currency = def.currency || 'money';
      const maxed = def.maxLevel != null && level >= def.maxLevel;
      let reason = null;
      if (maxed) reason = 'max_level';
      else if (canPurchaseExtra && !canPurchaseExtra(session, id, def)) reason = 'gated';
      else {
        for (const req of normalizeErequires(def.erequires)) {
          if (store.getLevel(req) <= 0) {
            reason = 'requires';
            break;
          }
        }
      }
      if (!reason && economy) {
        const balance = (currency === 'ep' || currency === 'exotic_particles')
          ? toNum(economy.currentExoticParticles)
          : toNum(economy.money);
        if (balance < cost) reason = 'funds';
      }
      const can = !reason && (!economy || store.canPurchase(id, economy, session));
      return {
        ok: true,
        id,
        title: def.title,
        def,
        level,
        nextLevel: level + 1,
        maxLevel: def.maxLevel,
        cost,
        costDecimal,
        currency,
        canPurchase: can,
        reason,
      };
    },

    canPurchase(id, economy, session = null) {
      const def = upgradeMap.get(id);
      if (!def) return false;
      if (def.maxLevel != null && store.getLevel(id) >= def.maxLevel) return false;
      for (const req of normalizeErequires(def.erequires)) {
        if (store.getLevel(req) <= 0) return false;
      }
      if (canPurchaseExtra && !canPurchaseExtra(session, id, def)) return false;
      const cost = store.getCost(id);
      const currency = def.currency || 'money';
      if (currency === 'ep' || currency === 'exotic_particles') {
        return toNum(economy.currentExoticParticles) >= cost;
      }
      return toNum(economy.money) >= cost;
    },

    purchase(id, economy, session = null) {
      if (!store.canPurchase(id, economy, session)) return false;
      const def = upgradeMap.get(id);
      const cost = store.getCost(id);
      const currency = def.currency || 'money';
      const spent = { money: 0, ep: 0 };
      if (currency === 'ep' || currency === 'exotic_particles') {
        if (!spendEp(economy, cost)) return false;
        spent.ep = cost;
      } else if (!economy.spendMoney(cost)) {
        return false;
      } else {
        spent.money = cost;
      }
      const newLevel = store.getLevel(id) + 1;
      levels.set(id, newLevel);
      cachedModifiers = null;
      return { ok: true, id, newLevel, spent };
    },

    getAutoSellPercent() {
      let total = 0;
      for (const [id, level] of levels) {
        const def = upgradeMap.get(id);
        if (def?.effect === 'auto_sell_percent') total += (def.value || 1) * level;
      }
      return total;
    },

    compileModifiers() {
      const entries = [];
      for (const [id, level] of levels) {
        entries.push({ def: upgradeMap.get(id), level });
      }
      cachedModifiers = compileModifiersFromEntries(entries, effectRegistry);
      return cachedModifiers;
    },

    getModifier(name) {
      if (!cachedModifiers) store.compileModifiers();
      if (name in cachedModifiers) return cachedModifiers[name];
      const camel = name.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
      return cachedModifiers[camel];
    },

    serialize: () => [...levels.entries()].map(([id, level]) => ({ id, level })),

    deserialize(data) {
      levels.clear();
      cachedModifiers = null;
      if (!Array.isArray(data)) return;
      for (const entry of data) levels.set(entry.id, entry.level);
    },
  };

  return store;
}

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

function buildClassList(def, { available, maxed, visible }) {
  const classList = ['upgrade'];
  if (def.section) classList.push(String(def.section));
  if (def.type) classList.push(String(def.type));
  if (def.effect) classList.push(`effect_${def.effect}`);
  if (def.partId) classList.push('cell_upgrade');
  if (def.currency === 'ep' || def.currency === 'exotic_particles') classList.push('ep');
  else classList.push('money');
  if (!visible) classList.push('hidden');
  if (!available) classList.push('locked');
  if (maxed) classList.push('maxed');
  return classList;
}

function isCellUpgradeVisible(def, store, componentMap, modifiers) {
  if (!def.partId) return true;
  const part = componentMap.get(def.partId);
  if (!part) return false;
  if (part.experimental && !modifiers?.experimentalUnlocked) return false;
  for (const req of normalizeErequires(part.erequires)) {
    if (store.getLevel(req) <= 0) return false;
  }
  return true;
}

export function createUpgradeStore(manifest, options = {}) {
  const levels = new Map();
  const upgradeDefs = manifest.upgrades || {};
  const effectRegistry = createEffectRegistry(options.effects);
  let canPurchaseExtra = options.canPurchaseExtra || null;
  const componentMap = new Map((manifest.components || []).map((c) => [c.id, c]));

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

    isAvailable(id, session = null) {
      const def = upgradeMap.get(id);
      if (!def) return false;
      if (def.maxLevel != null && store.getLevel(id) >= def.maxLevel) return false;
      for (const req of normalizeErequires(def.erequires)) {
        if (store.getLevel(req) <= 0) return false;
      }
      if (canPurchaseExtra && !canPurchaseExtra(session, id, def)) return false;
      return true;
    },

    listDisplayCatalog(session = null) {
      const modifiers = session?.modifiers || store.compileModifiers();
      return [...upgradeMap.values()].map((def) => {
        const level = store.getLevel(def.id);
        const preview = store.previewPurchase(def.id, session?.systems?.economy ?? null, session);
        const maxed = def.maxLevel != null && level >= def.maxLevel;
        const available = preview.reason !== 'gated' && preview.reason !== 'requires' && preview.reason !== 'unknown';
        const visible = isCellUpgradeVisible(def, store, componentMap, modifiers);
        const part = def.partId ? componentMap.get(def.partId) || null : null;
        const partRef = part ? {
          id: part.id,
          type: part.type || null,
          category: part.category || null,
          title: part.title || part.id,
          icon: part.icon || null,
          experimental: !!part.experimental,
          erequires: part.erequires || null,
          level: part.level || 1,
        } : null;
        const classList = buildClassList(def, { available, maxed, visible });
        return {
          id: def.id,
          title: def.title || def.id,
          description: def.description || null,
          icon: def.icon || partRef?.icon || null,
          iconPath: def.icon || partRef?.icon || null,
          type: def.type || null,
          section: def.section || def.type || null,
          currency: def.currency || 'money',
          maxLevel: def.maxLevel,
          level,
          cost: preview.cost,
          costDecimal: preview.costDecimal,
          available,
          visible,
          unlockVisible: visible,
          canPurchase: !!preview.canPurchase,
          reason: preview.reason,
          effect: def.effect,
          cellType: def.cellType || null,
          partId: def.partId || null,
          part: partRef,
          classList,
        };
      });
    },

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

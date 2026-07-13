import { createEffectRegistry, compileModifiersFromEntries } from './effect-registry.js';

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

export function createUpgradeStore(manifest, options = {}) {
  const levels = new Map();
  const upgradeDefs = manifest.upgrades || {};
  const effectRegistry = createEffectRegistry(options.effects);

  function flattenUpgrades(obj, prefix = '') {
    const result = [];
    for (const [key, val] of Object.entries(obj)) {
      if (val && typeof val === 'object' && val.id) {
        result.push(val);
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        result.push(...flattenUpgrades(val, `${prefix}${key}.`));
      }
    }
    return result;
  }

  const allUpgrades = flattenUpgrades(upgradeDefs);
  const upgradeMap = new Map(allUpgrades.map((u) => [u.id, u]));
  let cachedModifiers = null;

  return {
    getLevel(id) {
      return levels.get(id) || 0;
    },

    getDefinition(id) {
      return upgradeMap.get(id) || null;
    },

    getCost(id) {
      const def = upgradeMap.get(id);
      if (!def) return Infinity;
      const level = this.getLevel(id);
      if (def.maxLevel != null && level >= def.maxLevel) return Infinity;
      const base = def.baseCost ?? def.cost ?? 0;
      const multiplier = def.costMultiplier ?? 2;
      return Math.floor(base * Math.pow(multiplier, level));
    },

    canPurchase(id, economy) {
      const def = upgradeMap.get(id);
      if (!def) return false;
      if (def.maxLevel != null && this.getLevel(id) >= def.maxLevel) return false;
      if (def.erequires) {
        for (const req of def.erequires) {
          if (this.getLevel(req) <= 0 && toNum(economy.currentExoticParticles) < 1) return false;
        }
      }
      const cost = this.getCost(id);
      const currency = def.currency || 'money';
      if (currency === 'ep' || currency === 'exotic_particles') {
        return toNum(economy.currentExoticParticles) >= cost;
      }
      return toNum(economy.money) >= cost;
    },

    purchase(id, economy) {
      if (!this.canPurchase(id, economy)) return false;
      const def = upgradeMap.get(id);
      const cost = this.getCost(id);
      const currency = def.currency || 'money';
      if (currency === 'ep' || currency === 'exotic_particles') {
        if (!spendEp(economy, cost)) return false;
      } else if (!economy.spendMoney(cost)) {
        return false;
      }
      levels.set(id, this.getLevel(id) + 1);
      cachedModifiers = null;
      return true;
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
      if (!cachedModifiers) this.compileModifiers();
      if (name in cachedModifiers) return cachedModifiers[name];
      const camel = name.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
      return cachedModifiers[camel];
    },

    serialize() {
      return [...levels.entries()].map(([id, level]) => ({ id, level }));
    },

    deserialize(data) {
      levels.clear();
      cachedModifiers = null;
      if (!Array.isArray(data)) return;
      for (const entry of data) levels.set(entry.id, entry.level);
    },
  };
}

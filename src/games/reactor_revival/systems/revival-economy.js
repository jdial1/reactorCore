import { toDecimal, toNumber, serializeDecimal, deserializeDecimal } from '../../../engine/systems/decimal.js';

export function createRevivalEconomy(manifest) {
  const economyDef = manifest.economy || {};
  let money = toDecimal(economyDef.baseMoney || 0);
  let currentExoticParticles = toDecimal(0);
  let totalExoticParticles = toDecimal(0);
  let sessionPowerProduced = toDecimal(0);
  let sessionPowerSold = toDecimal(0);
  let sessionHeatDissipated = toDecimal(0);
  let soldPower = toDecimal(0);
  let soldHeat = toDecimal(0);
  let timeFlux = toDecimal(0);
  let protiumParticles = 0;
  let lastTickAutoSold = 0;
  let lastTickIncome = 0;
  const weaveQuantum = economyDef.weaveQuantum || 1_000_000;

  return {
    get money() { return money; },
    get currentExoticParticles() { return currentExoticParticles; },
    get totalExoticParticles() { return totalExoticParticles; },
    get sessionPowerProduced() { return sessionPowerProduced; },
    get sessionPowerSold() { return sessionPowerSold; },
    get sessionHeatDissipated() { return sessionHeatDissipated; },
    get timeFlux() { return timeFlux; },
    get protiumParticles() { return protiumParticles; },
    get soldPower() { return soldPower; },

    addProtiumParticles(count) {
      protiumParticles += count;
    },
    get soldHeat() { return soldHeat; },
    get lastTickAutoSold() { return lastTickAutoSold; },
    get lastTickIncome() { return lastTickIncome; },
    get weaveQuantum() { return weaveQuantum; },

    addMoney(amount) {
      const d = toDecimal(amount);
      money = money.add(d);
    },

    spendMoney(amount) {
      const d = toDecimal(amount);
      if (money.lt(d)) return false;
      money = money.sub(d);
      return true;
    },

    addExoticParticles(amount) {
      const d = toDecimal(amount);
      currentExoticParticles = currentExoticParticles.add(d);
      totalExoticParticles = totalExoticParticles.add(d);
    },

    spendExoticParticles(amount) {
      const d = toDecimal(amount);
      if (currentExoticParticles.lt(d)) return false;
      currentExoticParticles = currentExoticParticles.sub(d);
      return true;
    },

    addTimeFlux(amount) {
      timeFlux = timeFlux.add(toDecimal(amount));
    },

    spendTimeFlux(amount) {
      const d = toDecimal(amount);
      if (timeFlux.lt(d)) return false;
      timeFlux = timeFlux.sub(d);
      return true;
    },

    processTick(ctx) {
      const grid = ctx.grid;
      const upgrades = ctx.upgrades;
      lastTickAutoSold = 0;
      lastTickIncome = 0;

      if (grid.powerOutput > 0) {
        sessionPowerProduced = sessionPowerProduced.add(grid.powerOutput);
      }

      const autoSellEnabled = ctx.session
        ? !!(ctx.session.toggles?.auto_sell || ctx.session.mechanicsOverrides?.autoSellFromUpgrade)
        : true;
      const overrides = ctx.session?.mechanicsOverrides ?? {};
      const mods = ctx.session?.modifiers || {};
      const autoSellPercent = toNumber(
        overrides.autoSellPercent
        ?? mods.autoSellPercent
        ?? (upgrades?.getAutoSellPercent() || 0),
      );
      const sellPriceMultiplier = toNumber(
        overrides.sellPriceMultiplier ?? mods.sellPriceMultiplier,
      ) || 1;
      const sellCapBase = toNumber(overrides.alteredMaxPower) || grid.maxPower || 0;

      if (autoSellEnabled && autoSellPercent > 0 && grid.currentPower > 0) {
        const sellAmount = Math.floor(sellCapBase * autoSellPercent / 100);
        const sold = Math.min(sellAmount, grid.currentPower);
        grid.currentPower -= sold;
        const income = sold * this.getPrestigeMultiplier() * sellPriceMultiplier;
        this.addMoney(income);
        sessionPowerSold = sessionPowerSold.add(sold);
        soldPower = soldPower.add(sold);
        lastTickAutoSold = sold;
        lastTickIncome = income;
        ctx.result.soldPower = sold;
        ctx.result.moneyEarned = income;
        this.applyCapacitorAutosellHeat(grid, sold);
      }

      if (ctx.result.ventedHeat > 0) {
        sessionHeatDissipated = sessionHeatDissipated.add(ctx.result.ventedHeat);
        soldHeat = soldHeat.add(ctx.result.ventedHeat);
      }
    },

    applyCapacitorAutosellHeat(grid, sold) {
      let heatRatio = 0;
      grid.forEach((row, col, inst) => {
        const ratio = inst?.definition?.capacitorAutosellHeatRatio ?? 0;
        if (ratio <= 0) return;
        const cap = inst.definition.containment || 1;
        if ((grid.getTileHeat(row, col) || 0) / cap > 0.95) heatRatio = Math.max(heatRatio, ratio);
      });
      if (heatRatio > 0) grid.adjustCurrentHeat(sold * heatRatio);
    },

    calculatePrestigeReward() {
      const p = toNumber(sessionPowerProduced);
      const h = toNumber(sessionHeatDissipated);
      return Math.floor(Math.min(p, h) / weaveQuantum);
    },

    getPrestigeMultiplier() {
      const ep = toNumber(totalExoticParticles);
      const perEp = economyDef.prestigeMultiplierPerEp || 0.001;
      const cap = economyDef.prestigeMultiplierCap || 100;
      return 1 + Math.min(ep * perEp, cap);
    },

    reboot({ refundEp = false, keepEp = true } = {}) {
      let earned = 0;
      if (refundEp) {
        earned = this.calculatePrestigeReward();
        currentExoticParticles = totalExoticParticles;
      } else if (keepEp === false) {
        currentExoticParticles = toDecimal(0);
        totalExoticParticles = toDecimal(0);
      } else {
        earned = this.calculatePrestigeReward();
        if (earned > 0) {
          currentExoticParticles = currentExoticParticles.add(earned);
          totalExoticParticles = totalExoticParticles.add(earned);
        }
      }
      money = toDecimal(economyDef.baseMoney || 0);
      sessionPowerProduced = toDecimal(0);
      sessionPowerSold = toDecimal(0);
      sessionHeatDissipated = toDecimal(0);
      soldPower = toDecimal(0);
      soldHeat = toDecimal(0);
      lastTickAutoSold = 0;
      lastTickIncome = 0;
      return earned;
    },

    serialize() {
      return {
        money: serializeDecimal(money),
        currentExoticParticles: serializeDecimal(currentExoticParticles),
        totalExoticParticles: serializeDecimal(totalExoticParticles),
        sessionPowerProduced: serializeDecimal(sessionPowerProduced),
        sessionPowerSold: serializeDecimal(sessionPowerSold),
        sessionHeatDissipated: serializeDecimal(sessionHeatDissipated),
        soldPower: serializeDecimal(soldPower),
        soldHeat: serializeDecimal(soldHeat),
        timeFlux: serializeDecimal(timeFlux),
        protiumParticles,
      };
    },

    deserialize(data) {
      if (!data) return;
      if (data.money != null) money = deserializeDecimal(data.money);
      if (data.currentExoticParticles != null) currentExoticParticles = deserializeDecimal(data.currentExoticParticles);
      if (data.totalExoticParticles != null) totalExoticParticles = deserializeDecimal(data.totalExoticParticles);
      if (data.sessionPowerProduced != null) sessionPowerProduced = deserializeDecimal(data.sessionPowerProduced);
      if (data.sessionPowerSold != null) sessionPowerSold = deserializeDecimal(data.sessionPowerSold);
      if (data.sessionHeatDissipated != null) sessionHeatDissipated = deserializeDecimal(data.sessionHeatDissipated);
      if (data.soldPower != null) soldPower = deserializeDecimal(data.soldPower);
      if (data.soldHeat != null) soldHeat = deserializeDecimal(data.soldHeat);
      if (data.timeFlux != null) timeFlux = deserializeDecimal(data.timeFlux);
      if (data.protiumParticles != null) protiumParticles = data.protiumParticles;
    },
  };
}

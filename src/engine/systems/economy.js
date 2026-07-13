export function createEconomy(manifest) {
  const economyDef = manifest.economy || {};
  let money = economyDef.baseMoney || 0;
  let currentExoticParticles = 0;
  let totalExoticParticles = 0;
  let totalMoney = 0;
  let totalPower = 0;
  let totalHeat = 0;
  let timeFlux = 0;

  return {
    get money() { return money; },
    get currentExoticParticles() { return currentExoticParticles; },
    get totalExoticParticles() { return totalExoticParticles; },
    get timeFlux() { return timeFlux; },

    addMoney(amount) {
      money += amount;
      totalMoney += amount;
    },

    spendMoney(amount) {
      if (money < amount) return false;
      money -= amount;
      return true;
    },

    addExoticParticles(amount) {
      currentExoticParticles += amount;
      totalExoticParticles += amount;
    },

    addTimeFlux(amount) {
      timeFlux += amount;
    },

    spendTimeFlux(amount) {
      if (timeFlux < amount) return false;
      timeFlux -= amount;
      return true;
    },

    processTick(ctx) {
      const grid = ctx.grid;
      const upgrades = ctx.upgrades;
      const autoSellLevel = upgrades?.getLevel('auto_sell') || upgrades?.getLevel('improved_power_lines') || 0;
      const autoSellPercent = (upgrades?.getAutoSellPercent() || 0) + autoSellLevel;

      if (autoSellPercent > 0 && grid.currentPower > 0) {
        const sellAmount = Math.floor(grid.maxPower * autoSellPercent / 100);
        const sold = Math.min(sellAmount, grid.currentPower);
        grid.currentPower -= sold;
        const income = sold;
        this.addMoney(income);
        ctx.result.soldPower = sold;
        ctx.result.moneyEarned = income;
      }

      totalPower += grid.powerOutput;
      totalHeat += ctx.result.heatOutput || 0;
    },

    calculatePrestigeReward() {
      const min = Math.min(totalPower, totalHeat);
      if (min < 1e12) return 0;
      return Math.pow(min / 1e12, 0.60206);
    },

    reboot({ refundEp = false } = {}) {
      const earned = this.calculatePrestigeReward();
      if (refundEp) {
        currentExoticParticles = totalExoticParticles;
      } else {
        currentExoticParticles += earned;
        totalExoticParticles += earned;
      }
      money = economyDef.baseMoney || 0;
      totalPower = 0;
      totalHeat = 0;
      return earned;
    },

    serialize() {
      return {
        money,
        currentExoticParticles,
        totalExoticParticles,
        totalMoney,
        totalPower,
        totalHeat,
        timeFlux,
      };
    },

    deserialize(data) {
      if (!data) return;
      money = data.money ?? money;
      currentExoticParticles = data.currentExoticParticles ?? currentExoticParticles;
      totalExoticParticles = data.totalExoticParticles ?? totalExoticParticles;
      totalMoney = data.totalMoney ?? totalMoney;
      totalPower = data.totalPower ?? totalPower;
      totalHeat = data.totalHeat ?? totalHeat;
      timeFlux = data.timeFlux ?? timeFlux;
    },
  };
}

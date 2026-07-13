import { createEconomy } from '../../engine/systems/economy.js';
import { createUpgradeStore } from '../../engine/systems/upgrades.js';
import { createAutomation } from '../../engine/systems/automation.js';
import { assertCapability } from '../../engine/kernel/validateManifest.js';

export function createRuleset({ manifest }) {
  return {
    id: manifest.id,

    createPipeline() {
      return {
        loopOrder: 'legacy',
        stages: ['preTick', 'generateHeat', 'destroy', 'economy', 'meltdown'],
      };
    },

    createSystems({ manifest: m }) {
      return {
        economy: createEconomy(m),
        upgrades: createUpgradeStore(m),
        automation: createAutomation({
          onReplace: (row, col, def, economy) => {
            const cost = def.baseCost || 0;
            return economy.spendMoney(cost);
          },
        }),
      };
    },

    onSessionInit({ grid }) {
      grid.recalculateCaps();
    },

    onPrestige(session) {
      session.systems.upgrades?.deserialize([]);
    },

    requireCapability(capability) {
      assertCapability(manifest, capability);
    },
  };
}

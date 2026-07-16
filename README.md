# reactor-core-lib

Shared reactor simulation engine for Reactor Revival and related games.

## Requirements

**`decimal.js` is required** for revival (and any host using Decimal economy). Load it onto `globalThis.Decimal` before creating a session:

```js
import Decimal from 'decimal.js';
globalThis.Decimal = Decimal;
```

Without that, `toDecimal` falls back to `Number` and revival economy calls like `money.add` will throw.

Install alongside this package:

```bash
npm install reactor-core-lib decimal.js
```

## Host cutover notes (1.2.1)

**Mechanics overrides** — `recompileModifiers` owns `session.mechanicsOverrides` for: perpetual ids/categories, `hasProtiumLoader`, `autoReplaceCosts`, `sellPriceMultiplier`, `autoSellPercent`, `alteredMaxPower` (from `grid.maxPower`), `powerOverflowToHeatRatio` (from manifest economy). Hosts should stop merging a sidecar object for those keys.

**Upgrade UI** — Prefer `session.listUpgrades()` / `upgrades.listDisplayCatalog()` for title/icon/section/type metadata and `session.previewUpgrade(id)` / `session.isUpgradeAvailable(id)` for cost + gating. A thin host presentation catalog synced by id/level from `store.serialize()` is still fine.

**Tooltip / placement preview** — Call `computeNeighborPulseN`, `resolveCellCoefficients`, and `computeCellOutput` from this package; keep string formatting local.

**Blueprint paste** — Route paste/commit/cost UI through `APPLY_BLUEPRINT` / `COMMIT_BLUEPRINT_PLANNER` and `computeBlueprintCostBreakdown` / `computeBlueprintDiff`.

**Tile vent/transfer display** — Stats expose full multipliers (`vent_multiplier_eff` / `transfer_multiplier_eff`) and additive percents (`vent_multiplier_add` / `transfer_multiplier_add` = `(mult - 1) * 100`) for older tile getters.

## Changelog

### 1.2.1

Host cutover leftovers (formerly unlogged 1.2.0 surface) plus follow-up override/catalog polish:

- Tech-tree purchase gating via `createTechTreePurchaseGate` / `session.setCanPurchaseExtra`
- In-core effective vent/transfer from defs + modifiers + plating/capacitor grid bonuses
- Stats expose full and additive vent/transfer multipliers
- Full cell upgrade catalog (`cell_tick` / `cell_perpetual`) + `previewPurchase` / `listUpgrades` / `isUpgradeAvailable`
- `heatPowerMultiplier` on `runCellPhase` / `cellOutputs`
- Core-owned `mechanicsOverrides` sync: protium loader, auto-replace costs, sell price, auto-sell %, altered max power, overflow ratio
- Blueprint part costs honor `erequires` / Decimal when available

### 1.1.0

Revival cutover APIs: failure ownership fields/events, upgrade purchase policy, layout caps from `reactorPower`/`reactorHeat`, cell pulse coefficients in core (family `_cell_power` by type), partial `VENT_HEAT`, snapshot net-change / heat warning facts, containment segments export, blueprint cost helper.

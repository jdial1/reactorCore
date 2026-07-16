# reactor-core-lib

Shared reactor simulation engine for Reactor Revival and related games. Hosts own UI, input, and presentation; this package owns sim state, economy debit/credit for game actions, modifiers, and tick phases.

## Install

```bash
npm install reactor-core-lib decimal.js
```

**`decimal.js` is required** for revival (and any host using Decimal economy). Load it onto `globalThis.Decimal` before creating a session:

```js
import Decimal from 'decimal.js';
globalThis.Decimal = Decimal;
```

Without that, `toDecimal` falls back to `Number` and revival economy calls like `money.add` will throw.

## Quick start

```js
import { createGameSession } from 'reactor-core-lib';

const session = await createGameSession('reactor_revival');
session.tick();
session.dispatch({ type: 'PLACE_PART_PAID', payload: { row: 0, col: 0, id: 'uranium1' } });
```

Supported `GAME_IDS`: `reactor_revival`, `reactor_incremental`, `reactor_knockoff`, `ic2_reactor_planner_v3`, `ic2_exp_reactor_planner`.

## Host cutover guide (1.2.3)

Use these APIs so the host stops reimplementing cost math, sell previews, modifier key mapping, and upgrade catalog shaping.

### Paid placement (one dispatch)

**Problem:** Hosts debit money/EP, then place, then refund if place fails — easy to desync with `partCostForCell`.

**Use:** Atomic place+charge:

```js
session.dispatch({
  type: 'PLACE_PART',
  payload: { row, col, id, paid: true },
});
// or
session.dispatch({ type: 'PLACE_PART_PAID', payload: { row, col, id } });
// or
const result = session.placeComponentPaid(row, col, id);
// { ok, cost: { money, ep }, reason?, id, row, col }
```

Debit uses the same `partCostForCell` path as blueprint paste. On place failure, money/EP are refunded. Free place remains `PLACE_PART` without `paid` / `session.placeComponent`.

### Sell-credit preview (non-mutating)

**Problem:** Paste “sell replaced parts” checkboxes and UI totals need a 0.5× credit without calling `sellAllComponents` (which mutates the grid).

**Use:**

```js
const { total, items, sellMultiplier } = session.computeGridSellCredit();
// or computeGridSellCredit(session)
```

Same formula as sell-all / per-part sell (`floor(baseCost * level * 0.5)` by default). Pass an optional multiplier if host policy differs. Feed `total` into `filterAffordablePlacements` / paste preview as `sellCredit`.

### Modifier projection for tooltips / legacy tile code

**Problem:** Session modifiers are camelCase (`ventEffectiveness`, `autoSellPercent`). Host tile/`recalculate_stats` code often expects snake_case (`vent_effectiveness`).

**Use:**

```js
const reactor = session.hostModifiers;
// or projectModifiersForHost(session.modifiers)
// or session.projectModifiers()
```

Keeps camelCase keys and adds snake_case aliases (plus documented `MODIFIER_HOST_ALIASES`). Nested plain objects get both key styles. Hosts can drop the local mapping table.

### Upgrade display catalog

**Problem:** Hosts wrap upgrade defs into presentation objects (`classList`, part ref for cell-upgrade visibility, icon paths).

**Use:** `session.listUpgrades()` / `upgrades.listDisplayCatalog(session)` returns entries with:

| Field | Purpose |
| --- | --- |
| `title`, `description`, `icon` / `iconPath` | Labels and art |
| `section`, `type`, `currency`, `level`, `maxLevel`, `cost` | Panels and affordance |
| `available`, `canPurchase`, `reason` | Lock / buy state |
| `visible` / `unlockVisible` | Cell-upgrade unlock visibility (`erequires` / experimental) |
| `part` / `partId` | Linked component for cell upgrades |
| `classList` | Host CSS hooks (`upgrade`, section, `locked`, `maxed`, `hidden`, …) |

Still prefer `session.previewUpgrade(id)` for a single purchase preview. Tech-tree gating: `session.setCanPurchaseExtra(createTechTreePurchaseGate(...))`.

### Mechanics overrides

`recompileModifiers` owns `session.mechanicsOverrides` for: perpetual ids/categories, `hasProtiumLoader`, `autoReplaceCosts`, `sellPriceMultiplier`, `autoSellPercent`, `alteredMaxPower` (from `grid.maxPower`), `powerOverflowToHeatRatio` (from manifest economy). Stop merging a host sidecar for those keys.

### Blueprint paste

| Need | API |
| --- | --- |
| Cost of an absolute layout | `session.layoutCost(layout)` / `computeAbsoluteLayoutCost` |
| Diff money/EP breakdown | `session.blueprintCostBreakdown(layout)` |
| What fits with current funds + sell credit | `session.previewPartialBlueprint(layout)` / `filterAffordablePlacements` |
| Apply | `APPLY_BLUEPRINT` / `COMMIT_BLUEPRINT_PLANNER` |

**Part cost policy** — Default `partCostForCell`: `(baseCost\|cost) * level`; EP when `erequires` / `currency==='ep'` / `ecost` is set. Override via `policy.partCostForCell` if presentation prices diverge. Paste debit and absolute layout cost share this helper.

### Objectives

Pass presentation meltdown/failure without patching `session.engine`:

```js
session.getObjectiveProgress({ meltdown, hasMeltedDown, failure });
session.checkObjective(context);
```

### Containment / vent display

- `buildContainmentSegments(grid, { modifiers })` and snapshot `containmentSegments` include fullness + resolved vent/transfer rates per tile and segment totals.
- **Active venting** is intentional **grid-wide** capacitor level sum (`ventCapacitorMultiplier`), matching upgrade text (“+1% vent rate per Capacitor level”), not neighbor-local capacitors.
- Stats expose full multipliers (`vent_multiplier_eff` / `transfer_multiplier_eff`) and additive percents (`vent_multiplier_add` / `transfer_multiplier_add` = `(mult - 1) * 100`) for older tile getters.

### Tooltip / placement preview math

Call `computeNeighborPulseN`, `resolveCellCoefficients`, and `computeCellOutput` from this package; keep string formatting in the host.

## Changelog

### 1.2.3

Host cutover L–O — place/debit atomicity, sell preview, modifier aliases, richer upgrade catalog:

- Atomic paid place: `PLACE_PART` + `paid: true`, `PLACE_PART_PAID`, `session.placeComponentPaid` (debit via `partCostForCell`, refund on place failure)
- Non-mutating `computeGridSellCredit` / `session.computeGridSellCredit` for paste sell-credit UI
- `projectModifiersForHost` / `MODIFIER_HOST_ALIASES` / `session.hostModifiers` / `session.projectModifiers` (camelCase + snake_case)
- Richer `listDisplayCatalog`: `visible` / `unlockVisible`, `classList`, `part`, `iconPath`

### 1.2.2

Paste / objective / containment host cutover APIs:

- Export `filterAffordablePlacements`, `previewPartialBlueprint`, `computeAbsoluteLayoutCost`, `partCostForCell`, `partUsesEp`
- Session helpers: `previewPartialBlueprint`, `filterAffordablePlacements`, `layoutCost`, `blueprintCostBreakdown`, `getObjectiveProgress`, `checkObjective`
- Objective progress accepts `{ meltdown, hasMeltedDown, failure }` context (no `engine.meltdown` patching)
- `buildContainmentSegments` / snapshot `containmentSegments` include fullness + resolved vent/transfer rates
- Document part-cost policy and intentional grid-wide `active_venting`

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

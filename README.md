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

const session = await createGameSession({ gameId: 'reactor_revival' });
session.tick();
session.dispatch({ type: 'PLACE_PART_PAID', payload: { row: 0, col: 0, id: 'uranium1' } });
```

Supported `GAME_IDS`: `reactor_revival`, `reactor_incremental`, `reactor_knockoff`, `ic2_reactor_planner_v3`, `ic2_exp_reactor_planner`.

## Host cutover guide (1.2.6)

Use these APIs so the host stops reimplementing cost math, sell refunds, modifier key mapping, and upgrade catalog shaping.

### Paid placement (one dispatch)

**Problem:** Hosts debit money/EP, then place, then refund if place fails — easy to desync with `partCostForCell`. Occupied/OOB coordinates must not debit.

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
// reason: 'bounds' | 'occupied' | 'funds' | 'unknown' | 'place_failed' | ...
```

Validates **bounds and occupancy before debit** (no money lost on bad coords). Debit uses `partCostForCell`; refunds on place failure. Free place remains `PLACE_PART` without `paid` / `session.placeComponent` (may overwrite).

### Live part sell (life / containment)

**Problem:** Host `calculateSellValue` credits remaining cell life or containment heat damage. Core used to hardcode `floor(baseCost * level * 0.5)`; the revival bridge patched the money delta after `SELL_PART`.

**Use:**

```js
session.dispatch({ type: 'SELL_PART', payload: { row, col } });
// or preview
session.computeSellValue(row, col);
computeInstanceSellValue(inst, { row, col, grid });
```

Policy (matches host):

- Cells with ticks: `ceil(cost * min(1, max(0, ticksRemaining / maxTicks)))`
- Containment parts: `cost - ceil(cost * min(1, heatContained / containment))`
- Else full `cost` (`def.cost ?? def.baseCost`)
- Custom `sellValuePolicy` / `computeSellValue` returning non-finite values credits **0**

Isotope Stabilization keeps fractional `baseTicks` on the def (e.g. 15.75) for sell life ratios; placement/runtime ticks use `Math.floor(baseTicks)`.

Override with `session.sellValuePolicy = (inst, ctx) => number` or payload `policy.computeSellValue`.

### Sell-credit preview + blueprint sell

**Flat 0.5× (default):** matches `APPLY_BLUEPRINT` when `sellExisting` is set without instance options.

```js
const { total, items, sellMultiplier } = session.computeGridSellCredit();
session.dispatch({
  type: 'APPLY_BLUEPRINT',
  payload: { layout, sellExisting: true, sellCredit: total },
});
```

**Instance / life-ratio mode:** preview and execution must use the same mode. `APPLY_BLUEPRINT` with `sellExisting` **pre-flights affordability** using absolute layout cost vs `money + computeGridSellCredit(...)` **before** any sell; on `{ ok:false, reason:'deficit' }` the grid and wallet are unchanged. With `sellExisting`, preflight always uses the real sell proceeds (payload `sellCredit` is not required; host may leave it `0`). After a successful preflight sell, apply uses `sellCredit: 0` because proceeds are already in the economy.

```js
const credit = session.computeGridSellCredit(0.5, { mode: 'instance' });
session.dispatch({
  type: 'APPLY_BLUEPRINT',
  payload: {
    layout,
    sellExisting: true,
    sellMode: 'instance', // or lifeRatio: true
    sellCredit: credit.total,
  },
});
```

`sellAllComponents(session, mult, { mode: 'instance' })` uses the same policy as `SELL_PART`.

### Paid placement coords

`placeComponent` / `placeComponentPaid` / `SELL_PART` require finite integer in-range coords (`isValidGridCoord`). Malformed values (`NaN`, `undefined`, `0.5`) return `{ ok:false, reason:'bounds' }` (paid) or `false` (free/sell) with **no economy mutation**. Grid getters never throw on bad coords.

### Cell basePower (dual / quad)

**Problem:** Multi-cell entries used to bake scaled `basePower` (e.g. uranium2=2.5) while the host keeps template `base_power` with `cellMultiplier` 4/12.

**Lib:** Revival `parts.json` now stores the **single-cell coefficient** on all forms (`uranium1/2/3` → `basePower: 1`). Pulse math remains `basePower * (cellMultiplier + neighborN)`.

### Honor host effective power/heat (transitional)

Prefer core coeffs: `resolveCellCoefficients` + pulse. Mid-session display/test mutations without re-placing should set numeric `inst.power` / `inst.heat` (layout overrides, same shape as former `_effective*`).

`honorHostEffective` + `inst._effectivePower` / `_effectiveHeat` still work when the flag is set; drop the bridge once host tests use `inst.power`/`inst.heat` or core defs alone.

Purchasing upgrades rebinds placed instances to recompiled defs (reinforcement, isotope ticks, cell power, etc.).

### Component reinforcement

`component_reinforcement` is wired in `REVIVAL_EFFECTS` / effect-registry (+10% containment per level). Applied when building capacitor / coolant containment and plating `reactorHeat`. Recompile refreshes placed defs so explosion thresholds and caps update without host `_effectiveContainment`.

### Auto-sell / auto-buy operators

Revival `upgrades.json` includes `auto_sell_operator` / `auto_buy_operator`. Purchase enables `mechanicsOverrides.autoSellFromUpgrade` / `autoBuyFromUpgrade`, which OR with `toggles.auto_sell` / `toggles.auto_buy` so the host can drop a `!hasCoreDef` spend path.

### Prestige / achievements

- Call `session.reboot({ keepEp: true })` for prestige (default `reboot()` also sets `keepEp: !refundEp`). Prestige achievements unlock only when `keepEp === true`.
- Hosts that prestige without `reboot` should emit `prestigeCompleted` with `{ keepEp: true, fuelCellCount, sessionPowerProduced, sessionHeatDissipated }`.
- `criticality_recovery_auto` aborts when `soldHeatCount` increases during recovery (full vent / remaining ≤ ε), including after a prior full vent before criticality. A full `VENT_HEAT` (`ventHeat` + `soldHeat` pair) counts once.
- Achievement `serialize()` persists `{ unlocked, trackers, sustained, soldHeatCount, lastSnapshot }` (array form still deserializes as unlocked-only).
- Events: `achievementUnlocked` (camelCase, canonical) and `ACHIEVEMENT_UNLOCKED` alias; tick result includes `unlockedAchievementIds`.

### Layout caps (capacitor / plating)

Revival `parts.json` bakes host expansion for tiers 1–5:

- Capacitor: `reactorPower = 100 * 140^(level-1)`, `containment = 10 * 5^(level-1)`
- Plating: `reactorHeat = 250 * 150^(level-1)`

`recalculateCaps` sums `reactorPower` into `maxPower` and `reactorHeat` into `maxHeat`. Hosts can drop `applyLayoutCapsFromGame` once on 1.2.5+.

### Vent / transfer / containment rates

`resolveVentRate` / `resolveTransferRate` / `resolveContainment` use def base rates × compiled grid bonuses only. Host `_effectiveVent` / `_effectiveTransfer` / `_effectiveContainment` are **ignored** so the bridge can stop copying tile getters every sync.

### Heat-flow vectors (presentation)

**Problem:** Host heat-flow renderers expect last-tick vectors `{ fromRow, fromCol, toRow, toCol, amount }`.

**Use:**

```js
session.getHeatFlowVectors();
session.engine.getLastHeatFlowVectors();
session.tick().heatFlowVectors;
session.getSnapshot().heatFlowVectors;
```

Recorded from valve/exchanger transfers every tick. Accessors and snapshots return **copied frozen** vectors (safe to retain across ticks).

### Cell outputs (paused HUD / pulse display)

Last tick `cellOutputs` (power, heat, pulse, pulseN, **reflectorCount**, heatBoost) persist on:

```js
session.getCellOutputs();
session.engine.getLastCellOutputs();
session.getSnapshot().cellOutputs; // alias lastCellOutputs
```

Use this instead of host-local pulse recompute. `countActiveReflectorNeighbors(grid, row, col)` is exported for tooltips.

### Snapshot net change

`getSnapshot()` always sets numeric `powerNetChange` / `heatNetChange` (and `heatRatio`) from stats, falling back to `deriveReactorStats` when needed so hosts can drop overflow/auto-sell fallback math for live UI.

### Modifier projection for tooltips / legacy tile code

**Problem:** Session modifiers are camelCase (`ventEffectiveness`). Host tile code often expects snake_case.

**Use:** `session.hostModifiers` / `projectModifiersForHost(session.modifiers)` / `session.projectModifiers()`.

### Upgrade display catalog

Prefer `session.listUpgrades()` for `visible` / `classList` / `part` / `iconPath` / affordance. Tech-tree gating: `session.setCanPurchaseExtra(createTechTreePurchaseGate(...))`.

### Mechanics overrides

`recompileModifiers` owns `session.mechanicsOverrides` for: perpetual ids/categories, `hasProtiumLoader`, `autoReplaceCosts`, `sellPriceMultiplier`, `autoSellPercent`, `alteredMaxPower`, `powerOverflowToHeatRatio`. Stop merging a host sidecar for those keys.

### Blueprint paste

| Need | API |
| --- | --- |
| Cost of an absolute layout | `session.layoutCost(layout)` / `computeAbsoluteLayoutCost` |
| Diff money/EP breakdown | `session.blueprintCostBreakdown(layout)` |
| What fits with current funds + sell credit | `session.previewPartialBlueprint(layout)` / `filterAffordablePlacements` |
| Apply | `APPLY_BLUEPRINT` / `COMMIT_BLUEPRINT_PLANNER` |

**Part cost policy** — Default `partCostForCell`: `(baseCost\|cost) * level`; EP when `erequires` / `currency==='ep'` / `ecost` is set.

### Objectives

```js
session.getObjectiveProgress({ meltdown, hasMeltedDown, failure });
session.checkObjective(context);
```

### Containment / vent display

- `buildContainmentSegments` / snapshot `containmentSegments` include fullness + vent/transfer rates.
- **Active venting** is intentional **grid-wide** capacitor level sum.
- Stats expose `vent_multiplier_eff` / `transfer_multiplier_eff` and additive percent aliases.

### Tooltip / placement preview math

Call `computeNeighborPulseN`, `resolveCellCoefficients`, and `computeCellOutput` from this package; keep string formatting in the host.

## Changelog

### 1.2.6

Reinforcement, isotope sell parity, operators, achievement engine gaps:

- Wire `component_reinforcement` (+10%/level) into capacitor/coolant containment and plating `reactorHeat`; refresh placed defs on recompile
- Fractional Isotope Stabilization `baseTicks` for sell ratios; floor for runtime ticks
- `inst.power`/`inst.heat` layout overrides (drop `_effective*` bridge when ready); `honorHostEffective` remains transitional
- `auto_sell_operator` / `auto_buy_operator` upgrade defs; upgrade flags OR with toggles
- Prestige achievements gated on `keepEp === true`; `prestigeCompleted` payload support
- `criticality_recovery_auto` uses `soldHeatCount` (monotonic full-vent counter) so a vent after entry aborts even if heat was cleared earlier
- Persist achievement trackers + sustained state; `unlockedAchievementIds` on tick result; `ACHIEVEMENT_UNLOCKED` event alias

### 1.2.5

Host cutover follow-ups:

- Cap sell life ratio at 1; reject non-finite custom sell policies
- `cellPhase` reads `mechanicsOverrides.honorHostEffective` (matches stats)
- Package regression tests (`npm test`)
- Snapshot always populates `powerNetChange` / `heatNetChange`; persists frozen `cellOutputs` / `lastCellOutputs`
- Bake capacitor/plating tier-scaled `reactorPower` / `containment` / `reactorHeat`; `recalculateCaps` applies `reactorHeat`
- Vent/transfer/containment resolve from defs + modifiers only (ignore host `_effective*`)
- Export `countActiveReflectorNeighbors` / `copyCellOutputs` / `session.getCellOutputs`

### 1.2.4

Host cutover Q–U:

- `SELL_PART` / `computeInstanceSellValue` life-ratio and containment-damage refunds (optional `sellValuePolicy`)
- Revival dual/quad cells: `basePower`/`baseHeat` = single-cell coefficient (pulse uses `cellMultiplier`)
- `deriveReactorStats` passes `honorHostEffective` into cell coeff options
- Last-tick `heatFlowVectors` on tick result, snapshot, `engine.getLastHeatFlowVectors`, `session.getHeatFlowVectors` (copied/frozen)
- `placeComponentPaid` rejects `bounds` / `occupied` before debit; `placeComponent` returns false on OOB
- Instance-mode sell credit is actionable: `sellAllComponents` / `APPLY_BLUEPRINT` accept `sellMode: 'instance'` / `lifeRatio`
- `APPLY_BLUEPRINT` + `sellExisting` pre-flights affordability before sell (no destructive deficit)
- `computeGridSellCredit` always returns `sellMultiplier` (including empty/no-grid)
- Paid/free place and `SELL_PART` reject non-integer / non-finite coords via `isValidGridCoord` before any debit

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

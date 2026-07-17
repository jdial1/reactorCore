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

## Host cutover guide (1.2.7)

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
// authoritative tooltip / HUD preview (uses inst.ticks / def.baseTicks incl. fractional isotope max)
session.computeSellValue(row, col);
computeInstanceSellValue(inst, { row, col, grid });
```

Do **not** use host `part.ticks` (display life) as the sell denominator — that drifts from core fractional `baseTicks`.

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

Prefer core ownership for weave + reboot — call `session.prestige()` (or `session.reboot`) as the sole reboot owner and drop parallel host `applyDefaults` / `clearState`:

```js
session.previewPrestige(); // { earned, weaveQuantum, keepEp, fuelCellCount, ... }
session.calculatePrestigeReward();
session.prestige(); // reboot({ keepEp: true, refundEp: false }): clears grid, keeps EP upgrades, resets money upgrades / failure / objectives
session.reboot({ keepEp: true }); // same keep-EP path
session.reboot({ refundEp: true }); // full reset: clears all upgrades
```

`calculateWeaveEp(power, heat, weaveQuantum)` is exported for UI without a session. Revival `economy.weaveQuantum` defaults to `manifest.economy.weaveQuantum` (1e6).

`prestigeCompleted` is emitted by core when `keepEp === true`. Hosts that still run a parallel reset must emit the same payload themselves.

- Prestige achievements unlock only when `keepEp === true`.
- `criticality_recovery_auto` aborts when `soldHeatCount` increases during recovery (full vent / remaining ≤ ε), including after a prior full vent before criticality. A full `VENT_HEAT` (`ventHeat` + `soldHeat` pair) counts once.
- Achievement `serialize()` persists `{ unlocked, trackers, sustained, soldHeatCount, lastSnapshot }` (array form still deserializes as unlocked-only).
- Events: `achievementUnlocked` (camelCase, canonical) and `ACHIEVEMENT_UNLOCKED` alias; tick result includes `unlockedAchievementIds`.

### Compiled part catalog (shop / tooltips)

Prefer core compiled defs over host `part.recalculate_stats` multiplier walks:

```js
session.listParts(); // post-recompile containment / reactorPower / baseTicks / vent / …
session.getPart('capacitor2');
```

`listUpgrades()` `part` refs include the same compiled fields when `session.registry` is present.

**Catalog parity (1.2.7+):** compiled defs match host display for:

- `improved_heat_vents` / `improved_heat_exchangers`: +100%/level rate **and** capacity (`vent_boost` / `transfer_boost`)
- `improved_reflector_density`: doubles reflector `baseTicks` via `reflectorDurationMultiplier`
- `improved_neutron_reflection`: +1%/level on `powerIncrease`; `full_spectrum_reflectors`: +100% of base `powerIncrease` per level
- Experimental: `fluid_hyperdynamics`, `fractal_piping`, `ultracryonics` (coolant ×2^n)
- Cell `_cell_power`: `basePower` baked as `×2^level` in `getPart` / `listParts` (and runtime defs)
- Plating `reactorHeat`: unfloored `base × platingCapacity × (1+platingHeatBonus) × (1+reinforcement)` for ceramic_composite shop parity
- PA `epHeat`: `resolveEpHeat` / `session.resolveEpHeat` / catalog `epHeat` — `base × (IPA_level+1) × EP scale × (1−catalyst)`; tick EP chance uses the same scaled threshold

Drop host-local multiplier walks for these. `infused_cells` / `unleashed_cells` remain global cell `powerMultiplier` / `heatMultiplier` (knockoff-style), not reflector/transfer overlays from the upgrade blurb.

**PA epHeat scale** (host `deriveEpHeat` parity):

- EP scale = `1 + log10(EP / weaveQuantum)` when `EP > weaveQuantum`, else `1`
- `improved_particle_acceleratorsN` multiplies by `(upgradeLevel + 1)` for that part level
- `sub_atomic_catalysts` multiplies by `(1 − min(0.75, catalystReduction))`

### Display vent / transfer rates

```js
session.resolveDisplayRates('vent1'); // or placed inst / def
resolvePartDisplayRates(id, session);
resolveDisplayRates(inst, session.grid, session.modifiers);
```

Returns `{ vent, transfer, containment, baseVent, baseTransfer, bonuses }` using `resolveVentRate` / `resolveTransferRate` + grid plating/capacitor bonuses. Prefer this (or snapshot `containmentSegments`) over host `tile.recalculateEffectiveValues` / `Part.getEffectiveVentValue`.

### Auto-replace costs

Aligned with host `getAutoReplacementCost`:

- non-perpetual → `baseCost`
- perpetual cell / reflector → `baseCost * 1.5`
- perpetual capacitor → `baseCost * 10` (`capacitorSellMultiplier`, overridable via `manifest.mechanics.autoReplace.capacitorSellMultiplier`)

`session.mechanicsOverrides.autoReplaceCosts` and `session.partAutoReplaceCost(id)` rebuild on recompile from perpetual modifiers — hosts can stop feeding a sidecar every sync.

### Layout caps (capacitor / plating)

Revival `parts.json` bakes host expansion for tiers 1–5:

- Capacitor: `reactorPower = 100 * 140^(level-1)`, `containment = 10 * 5^(level-1)`
- Plating: `reactorHeat = 250 * 150^(level-1)`

`recalculateCaps` sums `reactorPower` into `maxPower` and `reactorHeat` into `maxHeat`. Hosts can drop `applyLayoutCapsFromGame` once on 1.2.5+.

### Vent / transfer / containment rates

`resolveVentRate` / `resolveTransferRate` / `resolveContainment` use def base rates × compiled grid bonuses only. Host `_effectiveVent` / `_effectiveTransfer` / `_effectiveContainment` are **ignored**. Prefer `session.resolveDisplayRates(...)` for tooltips (see Display vent / transfer rates above).

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

**Do not** recompute tile pulse/power in the host via `computeCellOutput`. Core owns live-cell coverage:

```js
session.getCellOutputs();           // last tick or last refresh
session.getCellOutputAt(row, col);  // single tile
session.refreshCellOutputs();       // non-mutating reproject (place/remove/recompile also call this)
session.projectCellOutputs();       // same projection without writing engine state
session.getSnapshot().cellOutputs;  // alias lastCellOutputs
```

Each entry: `{ row, col, power, heat, pulse, pulseN, reflectorCount, heatBoost }`. Guaranteed for every live cell (`category === 'cell'`, `ticks > 0`) after each tick and after mid-UI grid sync (`placeComponent` / `removeComponent` / `recompileModifiers`).

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

Prefer `session.getPart` / `compilePartStats` / `getPartDescription` / `getCellOutputs` for shop and tile tooltips. Keep string formatting in the host. Do **not** call `computeCellOutput` from host UI paths.

`getPart` / `compilePartStats` expose shop `power` / `heat` / `heatBoost` (forceful_fusion / `heat_power_multiplier` × `log1000(currentHeat)`). Drop host `applyHeatPowerMultiplier`.

### Pipeline stages

```js
session.getPipelineStages(); // e.g. revival: intents…achievements
```

### Objectives / stats contract

Objective checks and `deriveReactorStats` use core cell coefficients. They must **not** require the host to write `inst.power` / `inst.heat` (layout overrides remain optional only).

### Tick activity (L13 — adopt)

```js
session.hasTickActivity(); // live grid parts OR auto-sell with power>0 OR pending SELL_POWER/VENT_HEAT/SELL_PART
```

Host: delete `_hasSimulationActivity` / production `active_tiles` rebuilds. Keep part-classification test-only if needed.

### Cell pulse tooltips (L14 — adopt)

```js
session.describeCellPulse(row, col);
// { cellMultiplier, pulseN, pulse, reflectorCount, neighbors: [{ kind, contribution, ... }] }
```

Also exported: `computeNeighborPulseN`, `getCellOutputAt`. Host: delete tooltip pulse duplication.

### Economy single owner (L15 / L16)

Session economy is authoritative for money/EP. Mutate only via intents / session helpers; project host UI from snapshot after ticks:

```js
session.dispatch({ type: 'DEBIT_MONEY' | 'CREDIT_MONEY' | 'DEBIT_EP' | 'CREDIT_EP', payload: { amount } });
session.dispatch({ type: 'GRANT_REWARD', payload: { money, ep } }); // or { reward } / { ep_reward }
session.grantReward({ money, ep }); // objectives call this on complete
session.loadEconomyState(data); // load/save ONLY — never each tick
```

**Delete** host `syncEconomyFromGame` / per-tick `economy.deserialize`, `rewards.js` Decimal writers, and prestige host EP credits (`session.prestige()` owns weave EP). Listen for `economyChanged` / `rewardGranted` or read `getSnapshot().economy`.

### Prestige multiplier on credit (1.2.11 — adopt)

```js
session.getPrestigeMultiplier(); // 1 + min(totalEP * perEp, cap)
session.creditMoney(amount, { applyPrestige: true }); // game.addMoney path
session.grantReward({ money, ep, applyPrestige: true });
session.dispatch({ type: 'CREDIT_MONEY', payload: { amount, applyPrestige: true } });
```

Session applies the EP money multiplier — host must **not** multiply before credit. Drop bridge `getPrestigeMultiplier()` multiply-before-credit; UI can still read `session.getPrestigeMultiplier()` for display.

### Upgrade UI source (L17)

```js
session.listUpgrades(); // level, nextLevel, cost, erequires, classList, canPurchase, …
session.getUpgradeLevel(id);
session.purchaseUpgrade(id); // sole runtime level mutation
session.setUpgradeLevels(entries); // load / one-shot bridge bootstrap only
```

Drop host `UpgradeSet` level authority and bridge upgrade-level sync after bootstrap.

### Session command queue (L18 — adopt)

Session owns the intent/command queue. Host can delete `state.intent_queue` and push straight to session:

```js
session.dispatch({ type: 'SELL_POWER' });
session.enqueueIntent({ action: 'PLACE_PART', payload: { row, col, partId } }); // partId → id
session.runCommand({ type: 'VENT_HEAT' }); // enqueue + drain now
session.drainCommands(); // apply pending outside tick
session.peekCommands();
session.clearCommands();
session.pendingCommands;
```

`dispatch` / `enqueueIntent` accept `{ type }` or host `{ action }`, and normalize `partId` / `upgradeId` → `id`. Tick still drains via the `intents` stage; use `runCommand` / `drainCommands` for immediate UI ops (place/sell/power).

### Placed counts (L18 — adopt)

```js
session.getPlacedCount(type, level);
session.incrementPlacedCount(type, level); // UnlockManager counters
session.rebuildPlacedCounts(); // from live grid (load / resync)
session.setPlacedCounts(map); // hydrate from save
session.clearPlacedCounts(); // prestige
```

`PLACE_PART` / `PLACE_PART_PAID` auto-increment on success. Direct `placeComponent` / blueprint apply do not (host parity). Prestige clears counts.

### Active parts by category (L18 — adopt)

```js
const parts = session.getActiveParts();
// parts.active_cells / .cells, .active_vents, .active_exchangers, …
session.getActivePartList('active_cells');
session.classifyActivePart(row, col);
```

Entries are `{ row, col, id, type, level, category, ticks, … }` (not host Tile objects). Drop `bridge-parts` / `Engine.active_*` rebuilds for sim queries.

### Neighbor topology for tooltips (1.2.10 — adopt)

```js
const { containment, cell, reflector } = session.queryNeighbors(row, col);
// optional overrides: { range, topologyType }
session.countNeighborCategoryLevels(row, col, 'capacitor'); // active_venting tooltip
```

Matches host `computeTileNeighborLists` buckets (activated neighbors in part range/topology). Drop tooltip use of `tile.containmentNeighborTiles` / `computeTileNeighborLists` when ready.

### Operator display titles (1.2.10 — adopt)

```js
const entry = session.listUpgrades().find((u) => u.id === 'auto_sell_operator');
entry.displayTitle; // "Power Grid Sync"
entry.title;        // "Auto-Sell Operator"
```

`auto_buy_operator` → `Supply Chain Logistics`. Host can drop `OPERATOR_HOST_TITLES` and use `displayTitle || title`.

### Valve / reflector catalog bake (1.2.12 — adopt)

```js
session.getPart('overflow_valve').transfer; // baseTransfer × transferMultiplier (e.g. 1000×2.5)
session.getPart('reflector1').neighborPulseValue; // 1 + powerIncrease/100
```

Host can drop the valve multiply in `applyCompiledCatalogPart`. `transferMultiplier` remains on the compiled entry for display/debug.

## Changelog

### 1.2.12

Compiled catalog bake:

- Valve `transfer` includes part `transferMultiplier` (runtime def + `listParts`/`getPart`)
- Reflector `neighborPulseValue` on compiled parts / defs

### 1.2.11

Economy prestige multiplier ownership:

- `session.getPrestigeMultiplier()`
- `creditMoney` / `grantReward` / `CREDIT_MONEY` accept `{ applyPrestige: true }`
- Host drops multiply-before-credit via `game.getPrestigeMultiplier`

### 1.2.10

Tooltip neighbors + operator display titles:

- `session.queryNeighbors(row,col)` / `countNeighborCategoryLevels` — containment/cell/reflector lists for tooltips
- `listUpgrades[].displayTitle` for `auto_sell_operator` / `auto_buy_operator` host UI names

### 1.2.9

Shop heat-power, cellOutputs sync, pipeline stages, tick/economy ownership:

- Bake `heat_power` / forceful_fusion into `getPart` / `compilePartStats` shop `power` (+ `heatBoost`)
- `projectCellOutputs` / `session.refreshCellOutputs` — every live cell covered mid-UI without host `computeCellOutput`
- `session.getPipelineStages()`; objective/stats regression without `inst.power`/`inst.heat`
- `session.hasTickActivity()` — live parts / auto-sell power / pending sell-vent intents
- `session.describeCellPulse(row,col)` — structured pulse neighbor facts for tooltips
- Economy intents + `grantReward` / `GRANT_REWARD`; objectives auto-grant; `loadEconomyState` load-only
- `listUpgrades` richer catalog (`nextLevel`, `erequires`, `baseCost`); `getUpgradeLevel` / `setUpgradeLevels`
- Session command queue: `enqueueIntent` / `runCommand` / `drainCommands` / `peekCommands` (delete host `intent_queue`)
- `getPlacedCount` / `incrementPlacedCount` / `rebuildPlacedCounts` — UnlockManager counter ownership
- `getActiveParts` / `getActivePartList` — replace `bridge-parts` / `Engine.active_*`

### 1.2.8

Shop / stats / prestige cutover:

- Bake `cell_power` into compiled cell `basePower` (`×2^level`); runtime coeffs use the baked value
- Bake PA `epHeat` via `resolveEpHeat` / `session.resolveEpHeat` / `getPart.epHeat` (EP log scale + IPA + catalyst); tick EP chance uses the same threshold
- Plating `reactorHeat` no longer floored (ceramic_composite shop parity)
- Snapshot / stats prefer `mechanicsOverrides.autoSellPercent` (control-deck) over upgrade-only percent
- `session.prestige()` / `reboot({ keepEp })` keep EP upgrades, clear money upgrades, then recompile; preferred sole reboot owner

### 1.2.7

Host display / prestige / auto-replace cutover:

- `session.listParts` / `getPart` / `listCompiledParts` — post-recompile part catalog for shop/tooltips
- Catalog parity: vent/exchanger +100% boosts, reflector duration/power, experimental fluid/fractal/ultracryonics/full_spectrum
- `session.resolveDisplayRates` / `resolvePartDisplayRates` — vent/transfer/containment display helper
- `session.previewPrestige` / `prestige` / `calculatePrestigeReward` / `calculateWeaveEp` — weave EP ownership
- Auto-replace costs: perpetual cell/reflector 1.5×, perpetual capacitor 10×, else baseCost
- Document `session.computeSellValue(row,col)` as authoritative sell preview (fractional isotope `baseTicks`)

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

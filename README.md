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

## Changelog

### 1.1.0

Revival cutover APIs: failure ownership fields/events, upgrade purchase policy, layout caps from `reactorPower`/`reactorHeat`, cell pulse coefficients in core (family `_cell_power` by type), partial `VENT_HEAT`, snapshot net-change / heat warning facts, containment segments export, blueprint cost helper.

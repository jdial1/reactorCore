# Design Decisions

## Intentionally Not Included

These are **not planned**. The library is designed to be zero-dependency and framework-agnostic.

- **No `package.json`** - Distributed as raw ES modules, not npm
- **No `.gitignore`** - Not a git-first distribution model
- **No TypeScript declarations** - Pure JavaScript, no compile step
- **No tests** - Library is small enough for manual verification
- **No `dist/` build** - Source files are the distribution format

## Plugin Engine Architecture

Each game is a plugin pair under `src/games/<gameId>/`:

- `data.json` - numeric values, components, upgrades, feature flags
- `ruleset.js` - tick pipeline, system wiring, codecs, simulation modes

Shared engine lives under `src/engine/` (kernel, reactor behaviors, systems, runtime).

Research dossiers in `research/` are provenance docs only, not loaded at runtime.

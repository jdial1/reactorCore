import { createInstance, cloneInstance } from './createInstance.js';
import { createTileHeatMap } from './tileHeatMap.js';
import { isValidGridCoord } from '../kernel/gridUtils.js';

export function createReactorGrid(manifest) {
  const defaults = manifest.gridDefaults;
  const features = manifest.features || {};
  const useTileHeatMap = !!(features.tileHeatMap || features.valveMechanics);
  let gridRows = defaults.rows;
  let gridCols = defaults.cols;
  let grid = Array.from({ length: gridRows }, () => Array(gridCols).fill(null));
  let tileHeatMap = useTileHeatMap ? createTileHeatMap(gridRows, gridCols) : null;

  const reactorGrid = {
    get rows() { return gridRows; },
    get cols() { return gridCols; },
    currentHeat: 0,
    maxHeat: defaults.baseMaxHeat,
    currentPower: 0,
    maxPower: defaults.baseMaxPower || 0,
    ventedHeat: 0,
    euOutput: 0,
    powerOutput: 0,
    fluid: false,
    environment: {
      adjacentWaterBlocks: 0,
      adjacentIceBlocks: 0,
      biomeModifier: 1.0,
      activeChambers: 0,
    },

    setEnvironment: (env) => { Object.assign(reactorGrid.environment, env); },

    getComponentAt: (row, col) =>
      isValidGridCoord(row, col, reactorGrid) ? grid[row][col] : null,

    setComponentAt(row, col, instance) {
      if (!isValidGridCoord(row, col, reactorGrid)) return;

      const existing = grid[row][col];
      if (existing?.definition.onRemoveFromGrid) existing.definition.onRemoveFromGrid(existing, reactorGrid);
      if (tileHeatMap) tileHeatMap.setActivated(row, col, false);

      if (instance) {
        let isDuplicate = false;
        for (let r = 0; r < gridRows && !isDuplicate; r++) {
          for (let c = 0; c < gridCols && !isDuplicate; c++) {
            if ((r !== row || c !== col) && grid[r][c] === instance) isDuplicate = true;
          }
        }
        if (isDuplicate) instance = cloneInstance(instance);
        if (instance.definition.baseTicks && !instance.ticks) {
          instance.ticks = instance.definition.baseTicks;
        }
      }

      grid[row][col] = instance;
      if (instance?.definition.onAddToGrid) instance.definition.onAddToGrid(instance, reactorGrid);
      if (tileHeatMap && instance) {
        tileHeatMap.setActivated(row, col, true);
        if (instance !== existing) tileHeatMap.setIntegrity(row, col, 100);
      }
    },

    getTileHeat(row, col) {
      if (tileHeatMap) return tileHeatMap.getHeat(row, col);
      const inst = reactorGrid.getComponentAt(row, col);
      return inst?.currentHeat ?? 0;
    },

    setTileHeat(row, col, value) {
      if (tileHeatMap) {
        tileHeatMap.setHeat(row, col, value);
        return;
      }
      const inst = reactorGrid.getComponentAt(row, col);
      if (inst) inst.currentHeat = Math.max(0, value);
    },

    addTileHeat(row, col, delta) {
      if (tileHeatMap) {
        tileHeatMap.addHeat(row, col, delta);
        return;
      }
      const inst = reactorGrid.getComponentAt(row, col);
      if (inst) inst.currentHeat = Math.max(0, (inst.currentHeat || 0) + delta);
    },

    get tileHeatMap() {
      return tileHeatMap;
    },

    tileIndex: (row, col) => row * gridCols + col,

    resize(newRows, newCols) {
      const oldGrid = grid;
      const oldRows = gridRows;
      const oldCols = gridCols;
      gridRows = newRows;
      gridCols = newCols;
      grid = Array.from({ length: newRows }, () => Array(newCols).fill(null));
      if (tileHeatMap) {
        const next = createTileHeatMap(newRows, newCols);
        for (let r = 0; r < Math.min(oldRows, newRows); r++) {
          for (let c = 0; c < Math.min(oldCols, newCols); c++) {
            next.setHeat(r, c, tileHeatMap.getHeat(r, c));
            next.setIntegrity(r, c, tileHeatMap.getIntegrity(r, c));
            next.setActivated(r, c, tileHeatMap.isActivated(r, c));
          }
        }
        tileHeatMap = next;
      }

      for (let r = 0; r < Math.min(oldRows, newRows); r++) {
        for (let c = 0; c < Math.min(oldCols, newCols); c++) {
          const inst = oldGrid[r][c];
          if (inst) {
            grid[r][c] = inst;
            if (inst.definition.onAddToGrid) inst.definition.onAddToGrid(inst, reactorGrid);
          }
        }
      }

      for (let r = 0; r < oldRows; r++) {
        for (let c = 0; c < oldCols; c++) {
          if (r >= newRows || c >= newCols) {
            const inst = oldGrid[r][c];
            if (inst?.definition.onRemoveFromGrid) inst.definition.onRemoveFromGrid(inst, reactorGrid);
          }
        }
      }
      reactorGrid.recalculateCaps();
    },

    adjustCurrentHeat: (amount) => {
      reactorGrid.currentHeat = Math.max(0, reactorGrid.currentHeat + amount);
    },
    adjustMaxHeat: (amount) => { reactorGrid.maxHeat += amount; },
    adjustMaxPower: (amount) => { reactorGrid.maxPower += amount; },
    addEUOutput: (amount) => { reactorGrid.euOutput += amount; },
    addPower: (amount) => {
      reactorGrid.powerOutput += amount;
      reactorGrid.currentPower = Math.min(reactorGrid.maxPower, reactorGrid.currentPower + amount);
    },
    addPowerRaw: (amount) => {
      reactorGrid.powerOutput += amount;
      reactorGrid.currentPower += amount;
    },
    ventHeat: (amount) => { reactorGrid.ventedHeat += amount; },
    clearTickCounters: () => {
      reactorGrid.euOutput = 0;
      reactorGrid.powerOutput = 0;
      reactorGrid.ventedHeat = 0;
    },

    clearGrid() {
      for (let r = 0; r < gridRows; r++) {
        for (let c = 0; c < gridCols; c++) {
          reactorGrid.setComponentAt(r, c, null);
        }
      }
      reactorGrid.recalculateCaps();
    },

    getComponentCount() {
      let count = 0;
      for (let r = 0; r < gridRows; r++) {
        for (let c = 0; c < gridCols; c++) {
          if (grid[r][c]) count++;
        }
      }
      return count;
    },

    countComponents: () => reactorGrid.getComponentCount(),

    hasComponentId(id) {
      let found = false;
      reactorGrid.forEach((_, __, inst) => {
        if (inst?.definition?.id === id) found = true;
      });
      return found;
    },

    countCategory(category) {
      let count = 0;
      reactorGrid.forEach((_, __, inst) => {
        if (inst?.definition?.category === category) count++;
      });
      return count;
    },

    resetHeat: () => { reactorGrid.currentHeat = 0; },
    resetPower: () => { reactorGrid.currentPower = 0; },

    recalculateCaps() {
      reactorGrid.maxHeat = defaults.baseMaxHeat;
      reactorGrid.maxPower = defaults.baseMaxPower || 0;
      reactorGrid.forEach((_, __, inst) => {
        const def = inst?.definition;
        if (!def) return;
        const heatAdj = def.heatAdjustment ?? def.reactorHeat ?? 0;
        if (heatAdj) reactorGrid.maxHeat += heatAdj;
        const powerAdj = def.powerAdjustment ?? def.reactorPower ?? 0;
        if (powerAdj) reactorGrid.maxPower += powerAdj;
      });
    },

    forEach(callback) {
      for (let r = 0; r < gridRows; r++) {
        for (let c = 0; c < gridCols; c++) {
          callback(r, c, grid[r][c]);
        }
      }
    },

    getSnapshot() {
      const slots = [];
      reactorGrid.forEach((_, __, inst) => {
        slots.push(inst ? {
          id: inst.definition.id,
          heat: Math.round(inst.currentHeat),
          damage: Math.round(inst.currentDamage),
          ticks: inst.ticks || 0,
          enrichment: inst.enrichmentProgress || 0,
        } : 0);
      });
      return {
        rows: gridRows,
        cols: gridCols,
        currentHeat: reactorGrid.currentHeat,
        maxHeat: reactorGrid.maxHeat,
        currentPower: reactorGrid.currentPower,
        maxPower: reactorGrid.maxPower,
        fluid: reactorGrid.fluid,
        environment: { ...reactorGrid.environment },
        slots,
        tileHeat: tileHeatMap?.snapshot(),
      };
    },

    getBillOfMaterials() {
      const bom = {};
      for (let r = 0; r < gridRows; r++) {
        for (let c = 0; c < gridCols; c++) {
          const inst = grid[r][c];
          if (inst) {
            const name = inst.definition.displayName || inst.definition.name;
            bom[name] = (bom[name] || 0) + 1;
          }
        }
      }
      return bom;
    },
  };

  return reactorGrid;
}

export function createHistoryManager(grid, registry) {
  const undoStack = [];
  const redoStack = [];
  return {
    pushState() {
      undoStack.push(JSON.stringify(grid.getSnapshot()));
      redoStack.length = 0;
    },
    undo() {
      if (undoStack.length === 0) return false;
      redoStack.push(JSON.stringify(grid.getSnapshot()));
      const snap = JSON.parse(undoStack.pop());
      this._apply(snap);
      return true;
    },
    redo() {
      if (redoStack.length === 0) return false;
      undoStack.push(JSON.stringify(grid.getSnapshot()));
      const snap = JSON.parse(redoStack.pop());
      this._apply(snap);
      return true;
    },
    _apply(snap) {
      if (snap.rows !== grid.rows || snap.cols !== grid.cols) grid.resize(snap.rows, snap.cols);
      grid.clearGrid();
      grid.currentHeat = snap.currentHeat;
      grid.maxHeat = snap.maxHeat;
      grid.currentPower = snap.currentPower || 0;
      grid.maxPower = snap.maxPower || 0;
      grid.fluid = snap.fluid;
      grid.setEnvironment(snap.environment);
      let index = 0;
      for (let r = 0; r < snap.rows; r++) {
        for (let c = 0; c < snap.cols; c++) {
          const slot = snap.slots[index++];
          if (slot) {
            const inst = registry.create(slot.id);
            if (inst) {
              inst.currentHeat = slot.heat;
              inst.currentDamage = slot.damage;
              inst.ticks = slot.ticks || inst.definition.baseTicks || 0;
              inst.enrichmentProgress = slot.enrichment;
              grid.setComponentAt(r, c, inst);
            }
          }
        }
      }
      grid.recalculateCaps();
    },
  };
}

const base64Decode = (() => {
  if (typeof atob === 'function') return (str) => atob(str);
  if (typeof Buffer !== 'undefined') return (str) => Buffer.from(str, 'base64').toString('binary');
  throw new Error('No base64 decoder available');
})();

const base64Encode = (() => {
  if (typeof btoa === 'function') return (str) => btoa(str);
  if (typeof Buffer !== 'undefined') return (str) => Buffer.from(str, 'binary').toString('base64');
  throw new Error('No base64 encoder available');
})();

export function createCodecs(manifest) {
  return {
    exportJson(grid) {
      const slots = [];
      grid.forEach((_, __, inst) => {
        if (inst) {
          const slot = {
            id: inst.definition.id,
            heat: Math.round(inst.currentHeat),
            damage: Math.round(inst.currentDamage),
            ticks: inst.ticks || 0,
          };
          if (slot.heat === 0 && slot.damage === 0 && slot.ticks === 0) slots.push(slot.id);
          else slots.push(slot);
        } else {
          slots.push(0);
        }
      });
      const data = { v: 2, rows: grid.rows, cols: grid.cols, slots };
      if (grid.fluid) data.fluid = true;
      return JSON.stringify(data);
    },

    importJson(code, registry, grid) {
      try {
        const data = JSON.parse(code);
        if (!data.v || !data.slots) return { success: false, error: 'Invalid JSON format' };
        const rows = parseInt(data.rows, 10) || grid.rows;
        const cols = parseInt(data.cols, 10) || grid.cols;
        if (rows > grid.rows || cols > grid.cols) {
          return { success: false, error: `Grid too small: need ${rows}x${cols}` };
        }
        grid.clearGrid();
        if (data.fluid) grid.fluid = true;
        let index = 0;
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const slotData = data.slots[index++];
            if (slotData && slotData !== 0) {
              let key = typeof slotData === 'string' ? slotData
                : typeof slotData === 'number' ? slotData : slotData.id;
              const instance = registry.create(key);
              if (instance && typeof slotData === 'object') {
                if (slotData.heat) instance.currentHeat = slotData.heat;
                if (slotData.damage) instance.currentDamage = slotData.damage;
                if (slotData.ticks) instance.ticks = slotData.ticks;
              }
              if (instance) grid.setComponentAt(row, col, instance);
            }
          }
        }
        return { success: true, format: 'json' };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },

    exportTalonius(grid) {
      let code = '';
      grid.forEach((_, __, inst) => {
        const exportId = inst?.definition.exportId || 0;
        code += exportId.toString(16).padStart(2, '0');
      });
      return code;
    },

    importTalonius(code, registry, grid) {
      try {
        grid.clearGrid();
        const expectedLength = grid.rows * grid.cols * 2;
        if (code.length < expectedLength) {
          return { success: false, error: `Code too short: expected ${expectedLength}` };
        }
        let pos = 0;
        for (let row = 0; row < grid.rows; row++) {
          for (let col = 0; col < grid.cols; col++) {
            const id = parseInt(code.substring(pos, pos + 2), 16);
            pos += 2;
            if (id > 0) {
              const instance = registry.create(id);
              if (instance) grid.setComponentAt(row, col, instance);
            }
          }
        }
        return { success: true, format: 'talonius' };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },

    exportMauveCloud(grid) {
      let bytes = '';
      grid.forEach((_, __, inst) => {
        bytes += String.fromCharCode(inst?.definition.exportId || 0);
      });
      let code = `erp=${base64Encode(bytes)}`;
      if (grid.fluid) code += '|f';
      return code;
    },

    importMauveCloud(code, registry, grid) {
      try {
        const trimmed = code.startsWith('erp=') ? code.substring(4) : code;
        grid.clearGrid();
        const parts = trimmed.split('|');
        const bytes = base64Decode(parts[0]);
        let pos = 0;
        for (let row = 0; row < grid.rows; row++) {
          for (let col = 0; col < grid.cols; col++) {
            if (pos < bytes.length) {
              const id = bytes.charCodeAt(pos++);
              if (id > 0) {
                const instance = registry.create(id);
                if (instance) grid.setComponentAt(row, col, instance);
              }
            }
          }
        }
        if (parts.length > 1 && parts[1].charAt(0) === 'f') grid.fluid = true;
        return { success: true, format: 'mauvecloud' };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },

    importDesign(code, registry, grid) {
      if (!code || typeof code !== 'string') return { success: false, error: 'Empty code' };
      const trimmed = code.trim();
      if (trimmed.startsWith('{')) return this.importJson(trimmed, registry, grid);
      if (trimmed.startsWith('erp=')) return this.importMauveCloud(trimmed, registry, grid);
      if (trimmed.match(/^[0-9a-f]+$/i)) return this.importTalonius(trimmed, registry, grid);
      return { success: false, error: 'Unrecognized format' };
    },
  };
}

export function serializeSession(session) {
  return {
    gameId: session.gameId,
    saveVersion: 1,
    grid: session.grid.getSnapshot(),
    engine: { tickCount: session.engine.tickCount, meltdown: session.engine.meltdown },
    economy: session.systems.economy?.serialize(),
    upgrades: session.systems.upgrades?.serialize(),
    meta: { paused: session.paused },
  };
}

export function deserializeSession(session, data) {
  if (!data || data.gameId !== session.gameId) throw new Error('Invalid save data');
  const snap = data.grid;
  if (snap.rows !== session.grid.rows || snap.cols !== session.grid.cols) {
    session.grid.resize(snap.rows, snap.cols);
  }
  session.grid.clearGrid();
  session.grid.currentHeat = snap.currentHeat;
  session.grid.maxHeat = snap.maxHeat;
  session.grid.currentPower = snap.currentPower || 0;
  session.grid.maxPower = snap.maxPower || 0;
  session.grid.fluid = snap.fluid;
  let index = 0;
  for (let r = 0; r < snap.rows; r++) {
    for (let c = 0; c < snap.cols; c++) {
      const slot = snap.slots[index++];
      if (slot) {
        const inst = session.registry.create(slot.id);
        if (inst) {
          inst.currentHeat = slot.heat;
          inst.currentDamage = slot.damage;
          inst.ticks = slot.ticks || inst.definition.baseTicks || 0;
          session.grid.setComponentAt(r, c, inst);
        }
      }
    }
  }
  session.systems.economy?.deserialize(data.economy);
  session.systems.upgrades?.deserialize(data.upgrades);
  session.setPaused(data.meta?.paused || false);
}

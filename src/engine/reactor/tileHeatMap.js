export function createTileHeatMap(rows, cols) {
  const size = rows * cols;
  const heat = new Float32Array(size);
  const integrity = new Float32Array(size);
  integrity.fill(100);
  const activated = new Uint8Array(size);

  function idx(row, col) {
    return row * cols + col;
  }

  function inBounds(row, col) {
    return row >= 0 && row < rows && col >= 0 && col < cols;
  }

  return {
    rows,
    cols,
    size,

    idx,
    inBounds,

    getHeat: (row, col) => (inBounds(row, col) ? heat[idx(row, col)] || 0 : 0),
    setHeat: (row, col, value) => {
      if (inBounds(row, col)) heat[idx(row, col)] = Math.max(0, value);
    },
    addHeat: (row, col, delta) => {
      if (!inBounds(row, col)) return;
      const i = idx(row, col);
      heat[i] = Math.max(0, (heat[i] || 0) + delta);
    },
    getIntegrity: (row, col) => (inBounds(row, col) ? integrity[idx(row, col)] ?? 100 : 100),
    setIntegrity: (row, col, value) => {
      if (inBounds(row, col)) integrity[idx(row, col)] = Math.max(0, value);
    },
    isActivated: (row, col) => inBounds(row, col) && activated[idx(row, col)] !== 0,
    setActivated: (row, col, value) => {
      if (inBounds(row, col)) activated[idx(row, col)] = value ? 1 : 0;
    },
    resetIntegrity: (value = 100) => { integrity.fill(value); },
    snapshot: () => ({
      heat: Array.from(heat),
      integrity: Array.from(integrity),
      activated: Array.from(activated),
    }),

    deserialize(data) {
      if (!data) return;
      if (Array.isArray(data.heat)) {
        for (let i = 0; i < Math.min(data.heat.length, size); i++) heat[i] = data.heat[i] || 0;
      }
      if (Array.isArray(data.integrity)) {
        for (let i = 0; i < Math.min(data.integrity.length, size); i++) integrity[i] = data.integrity[i] ?? 100;
      }
      if (Array.isArray(data.activated)) {
        for (let i = 0; i < Math.min(data.activated.length, size); i++) activated[i] = data.activated[i] ? 1 : 0;
      }
    },

    copyToFloat32Array: (out) => { out.set(heat); return out; },
    applyFromFloat32Array: (src) => { heat.set(src.subarray(0, size)); },
  };
}

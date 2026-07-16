const OFFSETS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function isContainmentNode(inst) {
  if (!inst) return false;
  const def = inst.definition;
  if ((def.containment || 0) > 0) return true;
  const cat = def.category;
  return cat === 'heat_exchanger' || cat === 'heat_inlet' || cat === 'heat_outlet' || cat === 'valve';
}

function find(parent, i) {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

function union(parent, a, b) {
  const ra = find(parent, a);
  const rb = find(parent, b);
  if (ra !== rb) parent[rb] = ra;
}

export function buildContainmentSegments(grid) {
  const nodes = [];
  const indexOf = new Map();

  grid.forEach((row, col, inst) => {
    if (!isContainmentNode(inst)) return;
    const key = `${row},${col}`;
    indexOf.set(key, nodes.length);
    nodes.push({
      row,
      col,
      id: inst.definition.id,
      category: inst.definition.category,
      containment: inst.definition.containment || 0,
      heat: grid.getTileHeat(row, col) || 0,
    });
  });

  const parent = nodes.map((_, i) => i);
  for (let i = 0; i < nodes.length; i++) {
    const { row, col } = nodes[i];
    for (const [dr, dc] of OFFSETS) {
      const key = `${row + dr},${col + dc}`;
      const j = indexOf.get(key);
      if (j != null) union(parent, i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < nodes.length; i++) {
    const root = find(parent, i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(nodes[i]);
  }

  return [...groups.values()].map((tiles) => {
    let totalHeat = 0;
    let totalContainment = 0;
    for (const tile of tiles) {
      totalHeat += tile.heat;
      totalContainment += tile.containment;
    }
    return {
      tiles,
      totalHeat,
      totalContainment,
      pressure: totalContainment > 0 ? totalHeat / totalContainment : 0,
    };
  });
}

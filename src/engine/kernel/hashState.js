export function hashGridState(grid) {
  let hash = 0;
  grid.forEach((r, c, inst) => {
    if (!inst) return;
    const h = Math.round(inst.currentHeat);
    const d = Math.round(inst.currentDamage);
    hash = ((hash * 31) + r * 1000 + c * 100 + h + d) | 0;
  });
  hash = ((hash * 31) + Math.round(grid.currentHeat)) | 0;
  return hash;
}

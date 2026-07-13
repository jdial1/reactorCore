const OFFSETS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export function forEachNeighbor(grid, row, col, callback) {
  for (let i = 0; i < 4; i++) {
    const n = grid.getComponentAt(row + OFFSETS[i][0], col + OFFSETS[i][1]);
    if (n) callback(n);
  }
}

export function countNeighborsWith(grid, row, col, predicate) {
  let count = 0;
  for (let i = 0; i < 4; i++) {
    const n = grid.getComponentAt(row + OFFSETS[i][0], col + OFFSETS[i][1]);
    if (n && predicate(n)) count++;
  }
  return count;
}

export function getAdjacentInstances(grid, row, col) {
  const result = [];
  forEachNeighbor(grid, row, col, (n) => { result.push(n); });
  return result;
}

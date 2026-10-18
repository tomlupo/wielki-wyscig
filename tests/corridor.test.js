import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// The corridor index (scripts/build_terrain.py) and the files it names must agree, and its
// trees must stand inside the survey, off the road.
const root = new URL('../public/', import.meta.url);
const terrain = JSON.parse(readFileSync(new URL('terrain.json', root)));
const index = JSON.parse(readFileSync(new URL('corridor/index.json', root)));

test('every corridor tile has its desktop and phone image', () => {
  assert.ok(index.tiles.length > 20);
  for (const [i, j] of index.tiles) for (const d of ['hi', 'lo']) assert.ok(existsSync(new URL(`corridor/${d}/${i}_${j}.webp`, root)), `${d}/${i}_${j}`);
});

test('trees stand inside the survey, in a known kind, with a plausible crown', () => {
  const t = index.trees, hw = terrain.width / 2, hd = terrain.depth / 2;
  assert.equal(t.length % 4, 0);
  for (let k = 0; k < t.length; k += 4) {
    assert.ok(Math.abs(t[k] / 10) <= hw && Math.abs(t[k + 1] / 10) <= hd, `tree ${k / 4} outside`);
    assert.ok(t[k + 2] >= 5 && t[k + 2] <= 50, `tree ${k / 4} crown ${t[k + 2] / 10} m`);
    assert.ok([0, 1, 2].includes(t[k + 3]));
  }
});

test('the height grid has an even number of cells each way (a weak phone takes every second sample)', () => {
  assert.equal((terrain.nx - 1) % 2, 0);
  assert.equal((terrain.ny - 1) % 2, 0);
  assert.equal(atob(terrain.heights).length, terrain.nx * terrain.ny * 2);
});

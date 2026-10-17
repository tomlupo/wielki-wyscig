import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectMoments } from '../src/moments.js';

const race = JSON.parse(readFileSync(new URL('../data/race.json', import.meta.url)));
const { route } = JSON.parse(readFileSync(new URL('../public/terrain.json', import.meta.url)));

test('moments of the sample race tell its story in order', () => {
  const moments = detectMoments(race.riders, route);
  assert.deepEqual(moments.map(m => [m.kind, m.rider === null ? null : race.riders[m.rider].id]), [
    ['attack', 'B'], // Attacker goes clear of Diesel and leads
    ['attack', 'E'],
    ['gap', 'B'], // Attacker's lead peaks, Diesel starts the chase
    ['attack', 'A'], // Diesel catches Attacker and rides away
    ['attack', 'D'],
    ['sprint', 'A'],
    ['finish', 'A'],
  ]);
  assert.match(moments[0].label, /new leader/);
  assert.match(moments[2].label, /\+39s/);
  assert.equal(moments.at(-1).t, 1560);
});

test('moments are sorted, inside the race, spaced apart and capped', () => {
  const duration = 2040;
  for (const max of [3, 8]) {
    const moments = detectMoments(race.riders, route, { max });
    assert.ok(moments.length <= max);
    assert.ok(moments.some(m => m.kind === 'finish'), 'the finish always survives');
    moments.forEach((m, i) => {
      assert.ok(m.t >= 0 && m.t <= duration);
      if (i) assert.ok(m.t - moments[i - 1].t >= duration * 0.03);
    });
  }
});

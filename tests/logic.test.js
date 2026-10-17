import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { standings, formatGap, formatClock } from '../src/race.js';
import { altitudeAt, gradeAt, climbStats, gradeColor } from '../src/profile.js';
import { parseState, serializeState } from '../src/state.js';

const race = JSON.parse(readFileSync(new URL('../data/race.json', import.meta.url)));
const route = JSON.parse(readFileSync(new URL('../public/terrain.json', import.meta.url))).route;

test('standings: finishers rank by finish time, gaps are time behind the leader at the same point', () => {
  const t = 1700, rows = standings(race.riders, t);
  assert.deepEqual(rows.map(r => r.rank), [1, 2, 3, 4, 5]);
  const done = rows.filter(r => r.finished);
  assert.deepEqual(done.map(r => race.riders[r.index].id), ['A', 'B']);
  assert.equal(done[1].gap, 90);
  for (const row of rows) assert.ok(row.gap >= 0);
  // A rider still on the road ranks below every finisher and by distance among the rest.
  const riding = rows.filter(r => !r.finished);
  for (let i = 1; i < riding.length; i++) assert.ok(riding[i - 1].d >= riding[i].d);
});

test('standings at the start: everyone level, zero gaps', () => {
  for (const row of standings(race.riders, 0)) { assert.equal(row.d, 0); assert.equal(row.gap, 0); }
});

test('gap and clock formatting keep small gaps visible', () => {
  assert.equal(formatGap(0.44), '+0.4s');
  assert.equal(formatGap(23.4), '+23s');
  assert.equal(formatGap(134), '+2:14');
  assert.equal(formatClock(2040), '34:00');
  assert.equal(formatClock(3725), '1:02:05');
  assert.equal(formatClock(-5), '0:00');
});

test('profile: altitude interpolates, grades are sane, stats match the climb', () => {
  assert.equal(altitudeAt(route, 0), route[0][2]);
  assert.equal(altitudeAt(route, 1e9), route.at(-1)[2]);
  const s = climbStats(route);
  assert.ok(Math.abs(s.length - 7781.08) < 0.01);
  assert.ok(s.avgGrade > 4 && s.avgGrade < 6);
  for (let d = 0; d <= s.length; d += 250) assert.ok(Math.abs(gradeAt(route, d)) < 25);
  assert.deepEqual(gradeColor(-3), gradeColor(0));
  assert.deepEqual(gradeColor(40), [235, 64, 70]);
});

test('URL state round-trips and rejects junk', () => {
  const ctx = { riderIds: ['A', 'B'], duration: 2040 };
  const s = parseState(serializeState({ t: 1080.4, rider: 'B', cam: 'pov', speed: 60 }), ctx);
  assert.deepEqual({ t: s.t, rider: s.rider, cam: s.cam, speed: s.speed, shared: s.shared }, { t: 1080, rider: 'B', cam: 'pov', speed: 60, shared: true });
  const junk = parseState('?t=abc&r=Z&cam=drone&x=7', ctx);
  assert.deepEqual({ t: junk.t, rider: junk.rider, cam: junk.cam, speed: junk.speed, shared: junk.shared }, { t: 0, rider: null, cam: 'follow', speed: 30, shared: false });
  assert.equal(parseState('?t=99999', ctx).t, 2040);
});

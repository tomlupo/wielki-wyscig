import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRace, interpolate, timeAtDistance, telemetryAt } from '../src/race.js';
const race = JSON.parse(readFileSync(new URL('./fixtures/sample-race.json', import.meta.url)));
test('sample race has five valid full-segment efforts finishing in 26–34 minutes', () => {
  assert.equal(validateRace(race), race);
  assert.deepEqual(race.riders.map(r => r.samples.at(-1).t), [1560, 1650, 1770, 1890, 2040]);
  for (const rider of race.riders) {
    assert.equal(interpolate(rider.samples, -1, 'd'), 0);
    assert.equal(interpolate(rider.samples, 9999, 'd'), race.distanceM);
    for (const t of [120, 701.5, 1100]) assert.ok(Math.abs(timeAtDistance(rider.samples, interpolate(rider.samples, t, 'd')) - t) < 0.01);
  }
});
test('missing sensor values are not fabricated and zero power is retained', () => {
  const samples = [{t:0,d:0,watts:0,hr:null,speed:10},{t:10,d:30,watts:0,hr:150,speed:12}];
  assert.deepEqual(telemetryAt(samples,5), {watts:0,hr:null,speed:11});
  assert.equal(interpolate(samples,10,'hr'),150);
});
test('invalid ordering and duplicate timestamps are rejected', () => {
  const data=structuredClone(race);data.riders[0].samples[1].t=0;
  assert.throws(()=>validateRace(data), /timestamps/);
});

test('published race data (public/race.json) passes the v1 contract', () => {
  const live = JSON.parse(readFileSync(new URL('../public/race.json', import.meta.url)));
  assert.doesNotThrow(() => validateRace(live));
});

// The replay must show the official (Strava) segment times exactly: finish + clockOffset.
test('the recorded race finishes every rider at their official time on the shown clock', async () => {
  const { formatClock } = await import('../src/race.js');
  const real = validateRace(JSON.parse(readFileSync(new URL('../public/race.json', import.meta.url))));
  const official = real.riders.filter(r => r.officialTime != null);
  assert.ok(official.length >= 6);
  for (const r of official) assert.equal(formatClock(r.samples.at(-1).t + real.clockOffset + 1e-6), formatClock(r.officialTime), r.name);
  assert.throws(() => validateRace({ ...real, clockOffset: -1 }), /clock offset/);
});

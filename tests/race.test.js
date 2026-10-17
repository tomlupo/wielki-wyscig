import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRace, interpolate, timeAtDistance, telemetryAt } from '../src/race.js';
const race = JSON.parse(readFileSync(new URL('../data/race.json', import.meta.url)));
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

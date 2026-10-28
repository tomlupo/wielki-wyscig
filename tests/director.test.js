import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveEvents } from '../src/events.js';
import { createDirector } from '../src/director.js';
import { standings } from '../src/race.js';

// The real race, played through at each replay speed in 60 fps frames.
const race = JSON.parse(readFileSync(new URL('../public/race.json', import.meta.url)));
const riders = race.riders, duration = Math.max(...riders.map(r => r.samples.at(-1).t));
const targets = deriveEvents(riders);

function play(speed) {
  const director = createDirector({ targets, order: t => standings(riders, t).map(r => r.index), names: riders.map(r => r.name) });
  const cuts = [{ now: 0, time: 0, ...director.start(0, 0, speed) }];
  for (let now = 0, time = 0; time < duration; now += 1 / 60) {
    time = Math.min(duration, time + speed / 60);
    const c = director.update({ time, speed, now });
    if (c) cuts.push({ now, time, ...c });
  }
  return cuts;
}

for (const speed of [1, 10, 60]) {
  test(`at ${speed}×: cuts come at least 6 s apart on the wall clock`, () => {
    const cuts = play(speed);
    assert.ok(cuts.length > 3, `only ${cuts.length} cuts`);
    for (let k = 1; k < cuts.length; k++) assert.ok(cuts[k].now - cuts[k - 1].now >= 6 - 1e-9, `cut ${k} after ${cuts[k].now - cuts[k - 1].now} s`);
  });
}

test('at 10×: the camera is on the winner before the finish, within three seconds of playback', () => {
  const finish = targets.find(e => e.type === 'finish'), cuts = play(10);
  const before = cuts.findLast(c => c.time < finish.t);
  assert.equal(before.rider, finish.rider);
  assert.ok(finish.t - before.time <= 30, `cut ${finish.t - before.time} race s early`);
});

// The lower third shows for 3.2 s of wall time; for that whole stretch it must agree with the standings.
for (const speed of [1, 10, 60]) {
  test(`at ${speed}×: a "Leader" or "P2" caption stays true while it is on screen`, () => {
    for (const c of play(speed).filter(c => c.caption)) {
      const rank = c.caption.endsWith('Leader') ? 0 : 1;
      for (let s = 0; s <= 3.2 * speed; s += 0.5) {
        const t = Math.min(duration, c.time + s);
        assert.equal(standings(riders, t)[rank].index, c.rider, `"${c.caption}" at ${c.time.toFixed(1)} s is wrong ${s} s later`);
      }
    }
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildModel } from '../src/reel/model.js';
import { mapFrames, speedAt } from '../scripts/reel/timing.mjs';
import { makePlan } from '../scripts/reel/plan.mjs';

// The highlight reel's planner, on the real race and a footage-free copy of the clip sync.
const race = JSON.parse(readFileSync(new URL('../data/race.json', import.meta.url)));
const terrain = JSON.parse(readFileSync(new URL('../public/terrain.json', import.meta.url)));
const sync = JSON.parse(readFileSync(new URL('./fixtures/reel-sync.json', import.meta.url)));
const model = buildModel(race, terrain.route);
// A 125 BPM track with bars of four, and a jump in energy every 16 bars.
const beat = 60 / 125, beats = Array.from({ length: 260 }, (_, k) => +(k * beat).toFixed(3));
const track = { file: 'test.mp3', tempo: 125, start: 0, beats, downbeats: beats.filter((_, k) => k % 4 === 0), hits: beats.filter((_, k) => k % 64 === 32).map(t => ({ t, jump: 0.3 })) };

test('speed ramps integrate to the anchored value and never run backwards', () => {
  const t = mapFrames({ n: 90, fps: 30, ramp: [[0, 20], [1, 20], [2, 0.5], [3, 0.5]], anchor: { value: 1225, at: 1.5 } });
  for (let k = 1; k < t.length; k++) assert.ok(t[k] >= t[k - 1], `frame ${k} runs backwards`);
  const at = 1.5 * 30;
  assert.ok(Math.abs(t[at] - 1225) < 0.01, `anchor lands at ${t[at]}`);
  assert.equal(speedAt(4, 10), 4);
  // constant speed: exact line
  const lin = mapFrames({ n: 31, fps: 30, ramp: 2, anchor: { value: 100, at: 0 } });
  assert.ok(Math.abs(lin[30] - 102) < 1e-6);
});

for (const format of ['9x16', '16x9']) {
  const plan = makePlan({ format, inputs: { model, sync, beats: track } });

  test(`${format}: every cut lands on a beat, the reel runs 60–90 s, shots butt up`, () => {
    for (const s of plan.shots) {
      const sec = s.start / plan.fps, nearest = Math.min(...beats.map(b => Math.abs(b - sec)));
      assert.ok(nearest <= 0.5 / plan.fps + 1e-9, `${s.id} starts ${nearest.toFixed(3)} s off the beat`);
    }
    const seconds = plan.frames / plan.fps;
    assert.ok(seconds >= 60 && seconds <= 90, `${seconds} s`);
    plan.shots.forEach((s, i) => { if (i) assert.equal(s.start, plan.shots[i - 1].end, `gap before ${s.id}`); });
  });

  test(`${format}: race time and clip time stay in range and move forward within a shot`, () => {
    for (const s of plan.shots) {
      for (const arr of [s.t, s.src].filter(Boolean)) {
        for (let k = 1; k < arr.length; k++) assert.ok(arr[k] >= arr[k - 1] - 1e-9, `${s.id} runs backwards at ${k}`);
        assert.ok(Math.min(...arr) >= 0);
      }
      if (s.t) assert.ok(Math.max(...s.t) <= model.duration + 1e-9);
      if (s.src) { const c = sync.clips.find(x => x.file === s.clip); assert.ok(Math.max(...s.src) < c.duration, `${s.id} reads past the end of ${s.clip}`); }
    }
  });

  test(`${format}: data over a phone clip is about a rider confirmed in that clip`, () => {
    for (const c of plan.cues) {
      const shot = plan.shots.find(s => s.id === c.seg);
      const who = [c.rider, ...(c.riders ?? [])].filter(i => i != null);
      if (shot?.kind !== 'clip' || !who.length) continue;
      const clip = sync.clips.find(x => x.file === shot.clip);
      const seen = new Set([...(clip.sightings ?? []).map(s => s.rider), ...(clip.group ?? []), ...(clip.rider ? [clip.rider] : [])]);
      for (const i of who) assert.ok(seen.has(model.riders[i].id), `${c.type} on ${shot.id} is about ${model.riders[i].name}, who is not in ${shot.clip}`);
    }
  });

  test(`${format}: a caption that names a place holds for its whole time on screen`, () => {
    for (const c of plan.cues.filter(c => 'claimsHeld' in c)) {
      if (!c.claimsHeld) continue;
      const ts = plan.raceT.slice(c.from, c.to).filter(v => v != null);
      // "X leads" means X is first in the held order at every moment the caption is up
      assert.ok(ts.every(t => model.orderAt(t)[0] === c.rider), `"${c.sub}" is not true all the way through`);
    }
  });
}

test('the held order does not flicker: a new order lasts at least the hold before it shows', () => {
  let changes = 0;
  for (let t = 1; t <= model.duration; t++) if (model.orderAt(t).join() !== model.orderAt(t - 1).join()) changes++;
  // seven riders over ~33 minutes: a handful of real changes, not GPS jitter between riders side by side
  assert.ok(changes < 40, `${changes} order changes`);
});

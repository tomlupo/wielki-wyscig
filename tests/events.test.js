import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveEvents } from '../src/events.js';

// A rider whose distance follows `at(t)` (1 s samples) up a 1000 m climb.
function rider(name, at, len = 1000) {
  const samples = [];
  for (let t = 0; ; t++) {
    const d = Math.min(len, Math.max(samples.at(-1)?.d ?? 0, at(t)));
    samples.push({ t, d });
    if (d >= len) return { name, samples };
  }
}
const steady = (name, v) => rider(name, t => v * t);
const lines = events => events.map(e => `${e.t} ${e.type} ${e.text}`);

test('jitter: riders swapping places every few seconds make no event until one order holds 10 s', () => {
  // B rides level with A and the order flips every 3 s for a minute, then B is clearly ahead.
  const a = steady('A', 2);
  const delta = t => t < 20 ? -5 : t < 80 ? (Math.floor(t / 3) % 2 ? 1 : -1) : 6;
  const b = rider('B', t => 2 * t + delta(t));
  const events = deriveEvents([a, b]).filter(e => e.type === 'pass' || e.type === 'lead');
  assert.deepEqual(lines(events), ['80 lead B takes the lead from A']);
  // Without the hold rule the same data would report a lead change on every flip.
  assert.ok(deriveEvents([a, b], { hold: 0, swapWindow: 0, max: 99 }).filter(e => e.type === 'lead').length > 10);
});

test('a pass counts only when it holds 10 s', () => {
  const a = steady('A', 2), c = steady('C', 1.9);
  const duel = (b, opts) => lines(deriveEvents([a, b, c], opts).filter(e => (e.type === 'pass' || e.type === 'lead') && e.rider < 2 && e.other < 2));
  const brief = rider('B', t => 2 * t + (t >= 100 && t < 110 ? 0.5 : -0.5)); // ahead of A for 9 s
  assert.deepEqual(duel(brief, { swapWindow: 0 }), []);
  const held = rider('B', t => 2 * t + (t >= 100 && t < 111 ? 0.5 : -0.5)); // ahead of A for 10 s
  assert.deepEqual(duel(held, { swapWindow: 0 }), ['100 lead B takes the lead from A', '111 lead A takes the lead from B']);
  // A swap undone inside a minute is one skirmish with no net change: both halves are dropped.
  assert.deepEqual(duel(held), []);
  const late = rider('B', t => 2 * t + (t >= 100 && t < 200 ? 0.5 : -0.5)); // A comes back 100 s later: two real lead changes
  assert.deepEqual(duel(late), ['100 lead B takes the lead from A', '200 lead A takes the lead from B']);
});

test('passes below the lead name the place; a pass for the lead is told once, as the lead change', () => {
  const a = steady('A', 2.2), b = steady('B', 2), c = rider('C', t => t < 50 ? 1.8 * t : 90 + 2.1 * (t - 50));
  const events = deriveEvents([a, b, c]);
  assert.deepEqual(lines(events.filter(e => e.type === 'pass')), ['151 pass C passes B for 2nd']);
  const d = rider('D', t => t < 50 ? 1.8 * t : 90 + 2.6 * (t - 50));
  const lead = deriveEvents([a, b, d]).filter(e => e.type === 'lead' || (e.type === 'pass' && e.rider === 2 && e.other === 0));
  assert.deepEqual(lead.map(e => e.type), ['lead']);
  assert.match(lead[0].text, /^D takes the lead from A$/);
});

test('summit arrivals follow the finish order and the winner finishes once', () => {
  const riders = [steady('Slow', 1.5), steady('Fast', 2.5), steady('Mid', 2)];
  const events = deriveEvents(riders);
  assert.deepEqual(lines(events.filter(e => e.type === 'summit' || e.type === 'finish')), [
    '400 finish Fast wins at the summit · 6:40',
    '500 summit Mid tops out — 2nd',
    '667 summit Slow tops out — 3rd',
  ]);
});

test('the list is capped, keeps the finish, and reads in time order', () => {
  const riders = Array.from({ length: 8 }, (_, i) => rider(`R${i}`, t => (1.6 + 0.1 * i) * t + (i % 2 ? 40 : 0) * Math.min(1, t / 60) - 40 * Math.min(1, t / 60)));
  const all = deriveEvents(riders, { max: 999 }), capped = deriveEvents(riders, { max: 5 });
  assert.ok(all.length > 5);
  assert.equal(capped.length, 5);
  assert.ok(capped.some(e => e.type === 'finish'));
  for (let k = 1; k < capped.length; k++) assert.ok(capped[k - 1].t <= capped[k].t);
});

test('the real race (data/race.json) gives a short, ordered list ending with every rider at the top', () => {
  const race = JSON.parse(readFileSync(new URL('../data/race.json', import.meta.url)));
  const events = deriveEvents(race.riders);
  assert.ok(events.length >= 8 && events.length <= 15, `got ${events.length}`);
  for (let k = 1; k < events.length; k++) assert.ok(events[k - 1].t <= events[k].t);
  const winner = events.find(e => e.type === 'finish');
  assert.equal(race.riders[winner.rider].name, 'El Halcon');
  assert.equal(events.filter(e => e.type === 'summit').length, race.riders.length - 1);
});

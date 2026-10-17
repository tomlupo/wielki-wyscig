// Race events derived from the riders' samples alone: passes, lead changes,
// summit arrivals and the winner's finish. Each event is
// { t, type: 'pass'|'lead'|'summit'|'finish', rider, other?, rank?, text, score }.
//
// Every rider is read on one clock (`step` s). A change of order counts only
// when it HOLDS for `hold` s, so GPS jitter between two riders side by side
// makes no event. The event time is the moment the new order began.
import { interpolate, timeAtDistance } from './race.js';

const ORDINAL = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] ?? 'th');

export function deriveEvents(riders, { step = 1, hold = 10, swapWindow = 60, max = 15, summitD = null } = {}) {
  const n = riders.length, name = i => riders[i].name;
  const finish = riders.map(r => r.samples.at(-1).t);
  const duration = Math.max(...finish), len = Math.max(...riders.map(r => r.samples.at(-1).d));
  // Race position as one number: a finisher is ahead of everyone on the road, an earlier finisher ahead of a later one.
  const position = (i, t) => t >= finish[i] ? len + (duration - finish[i]) + 1 : interpolate(riders[i].samples, t, 'd');

  const pairs = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push({ i, j, held: 0, sign: 0, since: 0, passes: [] });
  const lead = { held: null, who: null, since: 0, changes: [] };
  // Place by the held order, not the raw one: one rider still level with another does not change a place yet.
  const rankHeld = i => 1 + pairs.reduce((k, q) => k + ((q.i === i && q.held < 0) || (q.j === i && q.held > 0)), 0);

  for (let t = 0; t <= duration + hold; t += step) {
    const p = riders.map((_, i) => position(i, Math.min(t, duration)));
    for (const pair of pairs) {
      const s = Math.sign(p[pair.i] - p[pair.j]);
      if (s !== pair.sign) { pair.sign = s; pair.since = t; }
      if (s && s !== pair.held && t - pair.since >= hold) {
        const before = pair.held;
        pair.held = s;
        if (before) {
          const [winner, loser] = s > 0 ? [pair.i, pair.j] : [pair.j, pair.i];
          pair.passes.push({ t: pair.since, rider: winner, other: loser, rank: rankHeld(winner) });
        }
      }
    }
    let top = 0;
    for (let i = 1; i < n; i++) if (p[i] > p[top]) top = i;
    if (p.filter(v => v === p[top]).length > 1) top = null; // a tie (the mass start) has no leader
    if (top !== lead.who) { lead.who = top; lead.since = t; }
    if (top !== null && top !== lead.held && t - lead.since >= hold) {
      if (lead.held !== null) lead.changes.push({ t: lead.since, rider: top, other: lead.held });
      lead.held = top;
    }
  }

  // A swap undone within `swapWindow` is one skirmish with no net change: drop both halves.
  const settle = (list, undoes) => list.reduce((kept, e) => {
    const last = kept.at(-1);
    if (last && e.t - last.t <= swapWindow && undoes(last, e)) kept.pop(); else kept.push(e);
    return kept;
  }, []);
  const leads = settle(lead.changes, (a, b) => b.rider === a.other);
  const events = leads.map(e => ({ ...e, type: 'lead', text: `${name(e.rider)} takes the lead from ${name(e.other)}`, score: 80 }));
  for (const pair of pairs) {
    for (const e of settle(pair.passes, (a, b) => b.rider === a.other)) {
      // A pass of the leader for the lead is told once, as the lead change.
      if (leads.some(l => l.rider === e.rider && l.other === e.other && Math.abs(l.t - e.t) <= hold)) continue;
      events.push({ ...e, type: 'pass', text: `${name(e.rider)} passes ${name(e.other)} for ${ORDINAL(e.rank)}`, score: 20 + (e.rank <= 3 ? 10 : 0) + 10 * e.t / duration });
    }
  }

  const order = riders.map((_, i) => i).sort((a, b) => finish[a] - finish[b]);
  const atFinish = summitD == null || summitD >= len - 150;
  order.forEach((i, k) => {
    const t = atFinish ? finish[i] : timeAtDistance(riders[i].samples, summitD);
    if (atFinish && k === 0) return;
    events.push({ t, type: 'summit', rider: i, rank: k + 1, text: `${name(i)} tops out — ${ORDINAL(k + 1)}`, score: k === 0 ? 70 : k < 3 ? 65 - 5 * k : 30 - k });
  });
  const winner = order[0];
  events.push({ t: finish[winner], type: 'finish', rider: winner, rank: 1, text: `${name(winner)} wins${atFinish ? ' at the summit' : ''}`, score: 100 });

  return events
    .sort((a, b) => b.score - a.score || a.t - b.t)
    .slice(0, max)
    .sort((a, b) => a.t - b.t || b.score - a.score);
}


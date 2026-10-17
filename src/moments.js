// Race moments for the scrubber, detected from the data alone: attacks, a gap
// that peaks and is then chased down, lead changes, passes, the steepest ramp,
// the final sprint and the finish. Each is { t, kind, label, rider }.
import { standings, interpolate, timeAtDistance } from './race.js';
import { gradeAt } from './profile.js';

// When two moments fall close together, the higher one keeps its marker.
const PRIORITY = { finish: 7, attack: 6, lead: 5, gap: 4, sprint: 4, summit: 3, steep: 2, pass: 1 };

export function detectMoments(riders, route, { step = 5, max = 8 } = {}) {
  const len = route.at(-1)[3];
  const duration = Math.max(...riders.map(r => r.samples.at(-1).t));
  const name = i => riders[i].name;
  const found = [];
  const add = (t, kind, label, rider = null) => found.push({ t: Math.round(t), kind, label, rider });

  const frames = [];
  for (let t = 0; t <= duration; t += step) {
    const rows = standings(riders, t), gap = [];
    for (const row of rows) gap[row.index] = row;
    frames.push({ t, rows, gap });
  }

  // Lead changes and passes: the order of riders still on the road changes.
  for (let k = 1; k < frames.length; k++) {
    const before = frames[k - 1].rows.filter(r => !r.finished).map(r => r.index);
    const now = frames[k].rows.filter(r => !r.finished).map(r => r.index);
    if (before.length !== now.length || now.length < 2) continue;
    if (frames[k].rows[0].finished) continue; // after the first finish the order is by finish time
    if (now[0] !== before[0]) add(frames[k].t, 'lead', `${name(now[0])} takes the lead`, now[0]);
    for (let p = 1; p < now.length; p++) {
      const was = before.indexOf(now[p]);
      if (was > p && before[p] !== now[p]) add(frames[k].t, 'pass', `${name(now[p])} passes ${name(before[p])}`, now[p]);
    }
  }

  // Attack: a rider level with another (≤ 3 s) is ≥ 8 s clear of them 150 s later.
  const span = Math.round(150 / step), lastAttack = new Map();
  for (let k = Math.round(60 / step); k + span < frames.length; k++) {
    const a = frames[k], b = frames[k + span];
    for (const i of riders.keys()) {
      if (a.gap[i].finished || b.gap[i].finished || (lastAttack.get(i) ?? -Infinity) > a.t - 300) continue;
      const dropped = [...riders.keys()].some(j => j !== i && !b.gap[j].finished
        && Math.abs(a.gap[i].gap - a.gap[j].gap) <= 3 && b.gap[j].gap - b.gap[i].gap >= 8);
      if (dropped) { lastAttack.set(i, a.t); add(a.t, 'attack', `${name(i)} attacks`, i); }
    }
  }

  // Gap peak: within one leader's stint, the lead over P2 tops 20 s and is then cut by 10 s or more.
  let stint = [];
  const closeStint = () => {
    if (stint.length < 2) return;
    let peak = stint[0];
    for (const f of stint) if (f.margin > peak.margin) peak = f;
    const after = stint.filter(f => f.t > peak.t);
    if (peak.margin >= 20 && after.length && Math.min(...after.map(f => f.margin)) <= peak.margin - 10)
      add(peak.t, 'gap', `${name(peak.leader)} +${Math.round(peak.margin)}s · the chase begins`, peak.leader);
  };
  for (const f of frames) {
    const [p1, p2] = f.rows;
    if (!p2 || p1.finished) { closeStint(); stint = []; continue; }
    if (stint.length && stint[0].leader !== p1.index) { closeStint(); stint = []; }
    stint.push({ t: f.t, leader: p1.index, margin: p2.gap });
  }
  closeStint();

  // Steepest ramp (200 m window, the profile's scale), when the first rider reaches it.
  let steepD = 0, steepG = -Infinity;
  for (let d = 0; d <= len; d += 25) { const g = gradeAt(route, d, 200); if (g > steepG) { steepG = g; steepD = d; } }
  const firstAt = d => Math.min(...riders.map(r => timeAtDistance(r.samples, d)));
  add(firstAt(steepD), 'steep', `Steepest ramp · ${steepG.toFixed(0)}%`);

  // Summit: the highest point of the road, unless it is the finish line itself.
  const top = route.reduce((best, p) => p[2] > best[2] ? p : best);
  const summitAtFinish = len - top[3] < 150;
  if (!summitAtFinish) add(firstAt(top[3]), 'summit', `Summit · ${Math.round(top[2])} m`);

  // Sprint: the winner's biggest jump in the last kilometre, 15 s of speed over the minute before.
  let sprint = null;
  const winner = standings(riders, duration)[0].index, ws = riders[winner].samples, finish = ws.at(-1).t;
  const v = (t0, t1) => (interpolate(ws, t1, 'd') - interpolate(ws, t0, 'd')) / (t1 - t0);
  for (let t = timeAtDistance(ws, Math.max(0, len - 1000)); t + 15 <= finish; t += step) {
    const surge = v(t, t + 15) / Math.max(0.5, v(Math.max(0, t - 60), t));
    if (!sprint || surge > sprint.surge) sprint = { t, surge };
  }
  if (sprint && sprint.surge >= 1.2) add(sprint.t, 'sprint', `${name(winner)} sprints`, winner);
  else add(timeAtDistance(ws, Math.max(0, len - 500)), 'sprint', 'Final 500 m', winner);
  add(finish, 'finish', `${name(winner)} wins${summitAtFinish ? ' at the summit' : ''}`, winner);

  // An attack that ends in a pass or a lead change is one moment, told as both.
  for (const m of found.filter(m => m.kind === 'lead' || m.kind === 'pass')) {
    const attack = found.find(a => a.kind === 'attack' && a.rider === m.rider && Math.abs(a.t - m.t) <= 120);
    if (!attack) continue;
    attack.label = `${name(m.rider)} attacks · ${m.kind === 'lead' ? 'new leader' : m.label.slice(name(m.rider).length + 1)}`;
    m.kind = 'merged';
  }

  // Keep the most important moment of any close cluster, then the top `max` by importance.
  const minGap = duration * 0.03, kept = [];
  for (const m of found.filter(m => m.kind !== 'merged').sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind] || a.t - b.t)) {
    if (kept.length < max && kept.every(k => Math.abs(k.t - m.t) >= minGap)) kept.push(m);
  }
  return kept.sort((a, b) => a.t - b.t);
}

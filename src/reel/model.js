// The race as the reel sees it: riders, events, climb stats, and a race order that only
// changes once a new order HOLDS (so a caption or a ticker never flickers between two
// riders side by side). Plain data and functions: used by the browser renderer
// (src/reel/main.js) and by the Node planner (scripts/reel/plan.mjs) alike.
import { interpolate, timeAtDistance, telemetryAt, formatClock, formatGap } from '../race.js';
import { elevationProfile, climbStats, gradeAt } from '../profile.js';
import { deriveEvents } from '../events.js';

export { interpolate, timeAtDistance, telemetryAt, formatClock, formatGap, gradeAt };

export function buildModel(race, route) {
  const riders = race.riders.map((r, i) => ({ ...r, index: i, letter: String.fromCharCode(65 + i), finish: r.samples.at(-1).t }));
  const duration = Math.max(...riders.map(r => r.finish));
  const len = route.at(-1)[3];
  const summit = route.reduce((best, p) => p[2] > best[2] ? p : best);
  const events = deriveEvents(riders, { summitD: summit[3] });
  const stats = climbStats(route), profile = elevationProfile(route);
  const byFinish = riders.map(r => r.index).sort((a, b) => riders[a].finish - riders[b].finish);
  const winner = byFinish[0];
  // Race position as one number: a finisher is ahead of everyone still riding, an earlier finisher ahead of a later one.
  const position = (i, t) => t >= riders[i].finish ? len + (duration - riders[i].finish) + 1 : interpolate(riders[i].samples, t, 'd');
  const distance = (i, t) => interpolate(riders[i].samples, t, 'd');

  // Held order, one entry per race second: a pair swaps only after the swap has lasted `hold` s.
  const HOLD = 8;
  const steps = Math.ceil(duration) + 1, held = [];
  {
    const n = riders.length, sign = [], since = [], keep = [];
    for (let i = 0; i < n * n; i++) { sign.push(0); since.push(0); keep.push(0); }
    for (let t = 0; t < steps; t++) {
      const p = riders.map((_, i) => position(i, Math.min(t, duration)));
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const k = i * n + j, s = Math.sign(p[i] - p[j]) || keep[k] || (riders[i].finish - riders[j].finish < 0 ? 1 : -1);
        if (s !== sign[k]) { sign[k] = s; since[k] = t; }
        if (!keep[k] || (s !== keep[k] && t - since[k] >= HOLD)) keep[k] = s;
      }
      // Rank by wins over the others in the held pairwise order (a total order in practice; ties by finish).
      const wins = riders.map((_, i) => riders.reduce((w, _, j) => w + (i < j ? keep[i * n + j] > 0 : i > j ? keep[j * n + i] < 0 : 0), 0));
      held.push(riders.map(r => r.index).sort((a, b) => wins[b] - wins[a] || riders[a].finish - riders[b].finish));
    }
  }
  const orderAt = t => held[Math.max(0, Math.min(steps - 1, Math.floor(t)))];
  // Gap to the leader at the same road point (as race.js standings), finishers by finish time.
  function gapToLeader(i, t) {
    const lead = orderAt(t)[0];
    if (t >= riders[i].finish && t >= riders[lead].finish) return riders[i].finish - riders[lead].finish;
    const d = distance(i, t);
    return Math.max(0, timeAtDistance(riders[i].samples, d) - timeAtDistance(riders[lead].samples, d));
  }
  // Does `rider` hold `rank` (0-based) for the whole race-time window [t0, t1]? Captions use this.
  function holdsRank(rider, rank, t0, t1) {
    for (let t = t0; t <= t1; t += 0.5) if (orderAt(t)[rank] !== rider) return false;
    return orderAt(t1)[rank] === rider;
  }
  // The official clock (DATA.md, Clock): race time + clockOffset, Strava's lead-in before the 3D road.
  const clockOffset = race.clockOffset ?? 0;
  const shown = t => t + clockOffset;
  const estimated = i => race.riders[i].officialTime == null && race.riders.some(r => r.officialTime != null);
  return { race, route, riders, duration, len, summitD: summit[3], events, stats, profile, winner, byFinish, position, distance, orderAt, gapToLeader, holdsRank, clockOffset, shown, estimated };
}

export const ORDINAL = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] ?? 'th');

export function validateRace(race) {
  if (race?.version !== 1 || !Array.isArray(race.riders) || !race.riders.length || race.riders.length > 12) throw new Error('Invalid race dataset. Expected version 1 and 1–12 riders.');
  if (!(race.distanceM > 0)) throw new Error('Race distance must be positive.');
  if (race.clockOffset != null && !(Number.isFinite(race.clockOffset) && race.clockOffset >= 0)) throw new Error('Invalid clock offset.');
  const ids = new Set();
  for (const rider of race.riders) {
    if (typeof rider.id !== 'string' || ids.has(rider.id) || typeof rider.name !== 'string' || rider.name.length > 48 || !/^#[0-9a-f]{6}$/i.test(rider.color)) throw new Error('Invalid rider identity or color.');
    ids.add(rider.id);
    if (!Array.isArray(rider.samples) || rider.samples.length < 2) throw new Error('Each rider needs at least two samples.');
    let previous = null;
    for (const sample of rider.samples) {
      if (!Number.isFinite(sample.t) || !Number.isFinite(sample.d) || sample.t < 0 || sample.d < 0 || sample.d > race.distanceM + 1) throw new Error('Invalid timestamp or distance.');
      if (previous && (sample.t <= previous.t || sample.d < previous.d)) throw new Error('Samples must have increasing timestamps and nondecreasing distance.');
      for (const key of ['speed', 'watts', 'hr']) if (sample[key] != null && (!Number.isFinite(sample[key]) || sample[key] < 0)) throw new Error(`Invalid ${key} value.`);
      previous = sample;
    }
    if (rider.samples[0].t !== 0 || rider.samples[0].d !== 0 || Math.abs(rider.samples.at(-1).d - race.distanceM) > 1) throw new Error('Each rider must cover the segment from t=0, d=0 to its finish.');
  }
  return race;
}
// The race: public/race.json (built by scripts/fit_to_race.py), checked against the v1 contract.
export async function loadRace() {
  const response = await fetch('/race.json');
  if (!response.ok) throw new Error(`Race data unavailable (${response.status}).`);
  return validateRace(await response.json());
}
function bracket(samples, value, key) {
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (samples[mid][key] < value) lo = mid; else hi = mid; }
  return [samples[lo], samples[hi]];
}
export function interpolate(samples, t, key) {
  if (t <= samples[0].t) return samples[0][key] ?? null;
  if (t >= samples.at(-1).t) return samples.at(-1)[key] ?? null;
  const [a, b] = bracket(samples, t, 't');
  if (t === a.t) return a[key] ?? null;
  if (t === b.t) return b[key] ?? null;
  if (a[key] == null || b[key] == null) return null;
  return a[key] + (b[key] - a[key]) * (t - a.t) / (b.t - a.t);
}
export function timeAtDistance(samples, d) {
  if (d <= samples[0].d) return samples[0].t;
  if (d >= samples.at(-1).d) return samples.at(-1).t;
  const [a, b] = bracket(samples, d, 'd');
  if (b.d === a.d) return a.t;
  return a.t + (b.t - a.t) * (d - a.d) / (b.d - a.d);
}
export function telemetryAt(samples, t) {
  if (t >= samples.at(-1).t) return { speed: 0, watts: 0, hr: null };
  const watts = interpolate(samples, t, 'watts'), hr = interpolate(samples, t, 'hr');
  return { speed: interpolate(samples, t, 'speed'), watts: watts == null ? null : Math.round(watts), hr: hr == null ? null : Math.round(hr) };
}

// Riders ordered by position at time t. Finished riders rank by finish time;
// the rest by distance covered. `gap` is seconds behind the leader at the same
// point of the road (for finishers: finish-time difference to the winner).
export function standings(riders, t) {
  const rows = riders.map((rider, index) => {
    const finish = rider.samples.at(-1).t;
    return { index, d: interpolate(rider.samples, t, 'd'), finish, finished: t >= finish };
  });
  rows.sort((a, b) => (b.finished - a.finished) || (a.finished ? a.finish - b.finish : b.d - a.d) || a.finish - b.finish);
  const lead = rows[0];
  for (const [rank, row] of rows.entries()) {
    row.rank = rank + 1;
    row.gap = row.finished
      ? row.finish - lead.finish
      : Math.max(0, timeAtDistance(riders[row.index].samples, row.d) - timeAtDistance(riders[lead.index].samples, row.d));
  }
  return rows;
}

// "+0.4s", "+12s", "+1:05": small gaps keep a decimal so a tight race never reads "+0:00".
export function formatGap(seconds) {
  const s = Math.max(0, seconds);
  if (s < 10) return `+${s.toFixed(1)}s`;
  if (s < 60) return `+${Math.round(s)}s`;
  return '+' + formatClock(s);
}

export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

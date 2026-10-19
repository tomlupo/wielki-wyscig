// Time mappings for the edit: speed ramps as keyframed speed curves, integrated per frame.
//
// A ramp is [[sec, speed], ...] (seconds into the segment → playback speed, 1 = real time),
// eased between keys with smoothstep so speed changes never jolt. A plain number is a
// constant speed. `anchor` pins one value: { value, at } = the mapped value at `at` s.

const smooth = u => u * u * (3 - 2 * u);

export function speedAt(ramp, sec) {
  if (typeof ramp === 'number') return ramp;
  if (sec <= ramp[0][0]) return ramp[0][1];
  for (let k = 1; k < ramp.length; k++) {
    const [s1, v1] = ramp[k];
    if (sec <= s1) { const [s0, v0] = ramp[k - 1]; return v0 + (v1 - v0) * smooth((sec - s0) / (s1 - s0 || 1)); }
  }
  return ramp.at(-1)[1];
}

// Values at frames 0..n-1 of a segment (frame k at sec = (k + offset) / fps), anchored so value(at) = anchor.value.
export function mapFrames({ n, fps, ramp, anchor, offset = 0, sub = 8 }) {
  // integrate speed over [0, sec] on a fine grid (sub steps per frame)
  const secs = Array.from({ length: n }, (_, k) => (k + offset) / fps);
  const lo = Math.min(0, anchor.at, ...secs), hi = Math.max(anchor.at, ...secs);
  const step = 1 / fps / sub, grid = [];
  for (let s = lo; s <= hi + step; s += step) grid.push(s);
  const cum = [0];
  for (let i = 1; i < grid.length; i++) cum.push(cum[i - 1] + (speedAt(ramp, grid[i - 1]) + speedAt(ramp, grid[i])) / 2 * step);
  const integ = s => { const x = (s - lo) / step, i = Math.max(0, Math.min(grid.length - 2, Math.floor(x))), f = x - i; return cum[i] + (cum[i + 1] - cum[i]) * f; };
  const base = anchor.value - integ(anchor.at);
  return secs.map(s => base + integ(s));
}

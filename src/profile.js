// Elevation profile of the reference road. `route` rows are
// [eastM, southM, altitudeM, cumulativeDistanceM] (see DATA.md).

function altitudeAt(route, d) {
  const len = route.at(-1)[3];
  d = Math.max(0, Math.min(len, d));
  let lo = 0, hi = route.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (route[mid][3] < d) lo = mid; else hi = mid; }
  const a = route[lo], b = route[hi], span = b[3] - a[3];
  return span ? a[2] + (b[2] - a[2]) * (d - a[3]) / span : a[2];
}

// Grade in percent over a centred window, so single GPS jitters do not spike.
export function gradeAt(route, d, window = 100) {
  const len = route.at(-1)[3];
  const a = Math.max(0, Math.min(len - window, d - window / 2)), b = Math.min(len, a + window);
  return b > a ? (altitudeAt(route, b) - altitudeAt(route, a)) / (b - a) * 100 : 0;
}

export function elevationProfile(route, step = 25) {
  const len = route.at(-1)[3], points = [];
  for (let d = 0; d < len; d += step) points.push({ d, ele: altitudeAt(route, d), grade: gradeAt(route, d) });
  points.push({ d: len, ele: altitudeAt(route, len), grade: gradeAt(route, len) });
  return points;
}

export function climbStats(route) {
  const len = route.at(-1)[3];
  let gain = 0, maxGrade = -Infinity;
  for (let i = 1; i < route.length; i++) gain += Math.max(0, route[i][2] - route[i - 1][2]);
  for (let d = 0; d <= len; d += 50) maxGrade = Math.max(maxGrade, gradeAt(route, d, 200));
  const start = route[0][2], top = route.at(-1)[2];
  return { length: len, start, top, gain, avgGrade: (top - start) / len * 100, maxGrade };
}

// Colour ramp for road grade: flat green → 4% yellow → 8% orange → 12%+ red.
const STOPS = [[0, [86, 211, 140]], [4, [244, 222, 92]], [8, [255, 146, 62]], [12, [235, 64, 70]]];
export function gradeColor(grade) {
  const g = Math.max(STOPS[0][0], Math.min(STOPS.at(-1)[0], grade));
  let i = 0;
  while (i < STOPS.length - 2 && g > STOPS[i + 1][0]) i++;
  const [g0, c0] = STOPS[i], [g1, c1] = STOPS[i + 1], f = (g - g0) / (g1 - g0);
  return c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
}

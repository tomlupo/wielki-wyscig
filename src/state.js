// Shareable view state in the URL query: ?t=1080&r=rider-b&cam=follow&x=4
export const CAMERAS = ['follow', 'overview', 'side', 'free']; // the three presets (keys 1–3), then the free orbit
export const SPEEDS = [1, 4, 16];
export const DEFAULTS = { t: 0, rider: null, cam: 'follow', speed: 16 };
const LEGACY_CAMERAS = { pov: 'follow' }; // links shared before the rider view was retired

export function parseState(search, { riderIds, duration }) {
  const q = new URLSearchParams(search), state = { ...DEFAULTS, shared: false };
  const t = Number(q.get('t'));
  if (q.has('t') && Number.isFinite(t)) { state.t = Math.max(0, Math.min(duration, t)); state.shared = true; }
  if (riderIds.includes(q.get('r'))) { state.rider = q.get('r'); state.shared = true; }
  const cam = LEGACY_CAMERAS[q.get('cam')] ?? q.get('cam');
  if (CAMERAS.includes(cam)) { state.cam = cam; state.shared = true; }
  const x = Number(q.get('x'));
  if (SPEEDS.includes(x)) state.speed = x;
  return state;
}

export function serializeState({ t, rider, cam, speed }) {
  const q = new URLSearchParams();
  q.set('t', String(Math.round(t)));
  if (rider) q.set('r', rider);
  q.set('cam', cam);
  if (speed !== DEFAULTS.speed) q.set('x', String(speed));
  return '?' + q.toString();
}

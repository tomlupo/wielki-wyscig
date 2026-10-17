// Shareable view state in the URL query: ?t=1080&r=rider-b&cam=follow&x=30
export const CAMERAS = ['follow', 'pov', 'overview', 'free']; // order of the camera buttons and keys 1–4
export const SPEEDS = [1, 5, 10, 30, 60];
export const DEFAULTS = { t: 0, rider: null, cam: 'follow', speed: 10 };

export function parseState(search, { riderIds, duration }) {
  const q = new URLSearchParams(search), state = { ...DEFAULTS, shared: false };
  const t = Number(q.get('t'));
  if (q.has('t') && Number.isFinite(t)) { state.t = Math.max(0, Math.min(duration, t)); state.shared = true; }
  if (riderIds.includes(q.get('r'))) { state.rider = q.get('r'); state.shared = true; }
  if (CAMERAS.includes(q.get('cam'))) { state.cam = q.get('cam'); state.shared = true; }
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

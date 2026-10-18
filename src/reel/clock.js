// A virtual clock for offline rendering. The 3D world animates on performance.now()
// (camera moves, sky, flag, pedalling); here that clock only moves when the renderer
// steps it, one output frame at a time, so every render of the same plan is identical.
let nowMs = 0;
const real = performance.now.bind(performance);
performance.now = () => nowMs;

export const clock = {
  set(ms) { nowMs = ms; },
  get() { return nowMs; },
  real, // wall time, for logging only
};

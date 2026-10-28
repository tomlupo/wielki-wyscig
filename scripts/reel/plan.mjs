// The planner: storyboard + race data + clip sync + beat grid → a frame-exact plan (plan.json)
// that the renderer (src/reel/main.js), the frame extractor and the audio mix all read.
//
//   node scripts/reel/plan.mjs --format 9x16 [--preview]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel } from '../../src/reel/model.js';
import { storyboard } from './storyboard.mjs';
import { mapFrames } from './timing.mjs';
import { ROOT, WORK, MUSIC } from './paths.mjs';

export const FORMATS = { '9x16': [1080, 1920], '16x9': [1920, 1080] };
const DATA_CUES = new Set(['stat', 'trace', 'duel', 'rider', 'standings', 'profile', 'finisher', 'event']);

export function loadInputs() {
  const race = JSON.parse(readFileSync(`${ROOT}/public/race.json`, 'utf8'));
  const terrain = JSON.parse(readFileSync(`${ROOT}/public/terrain.json`, 'utf8'));
  const model = buildModel(race, terrain.route);
  const sync = JSON.parse(readFileSync(`${WORK}/sync.json`, 'utf8'));
  const beatsPath = `${WORK}/beats.json`;
  const beats = existsSync(beatsPath) ? JSON.parse(readFileSync(beatsPath, 'utf8')) : null;
  // The track's credit line, from a sidecar next to it: data/music/<track>.json → { "credit": "…" }
  const sidecar = beats && `${MUSIC}/${beats.file.replace(/\.\w+$/, '')}.json`;
  const credits = { music: sidecar && existsSync(sidecar) ? JSON.parse(readFileSync(sidecar, 'utf8')).credit : null };
  return { model, sync, beats, credits };
}

// The beat grid in reel time. Without a track: 120 BPM, bars of 4, from 0.
function grid(beats, total) {
  if (!beats) {
    const b = [], step = 0.5;
    for (let t = 0; t <= total + 8; t += step) b.push(+t.toFixed(4));
    return { beats: b, bars: b.filter((_, k) => k % 4 === 0), offset: 0, synthetic: true };
  }
  const off = beats.start ?? 0; // music time of reel frame 0
  return { beats: beats.beats.map(t => t - off).filter(t => t >= 0), bars: beats.downbeats.map(t => t - off).filter(t => t >= 0), hits: (beats.hits ?? []).map(h => h.t - off).filter(t => t >= 0), offset: off, synthetic: false };
}
const nearest = (list, t) => list.reduce((best, v) => Math.abs(v - t) < Math.abs(best - t) ? v : best, list[0]);

export function makePlan({ format = '9x16', fps = 30, preview = false, inputs = loadInputs() } = {}) {
  const { model, sync, beats, credits } = inputs;
  const [W0, H0] = FORMATS[format];
  const scale = preview ? 0.5 : 1, W = W0 * scale, H = H0 * scale;
  const portrait = H > W;
  const { segments, spans, facts } = storyboard({ model, sync, fmt: format, credits });

  // ---- cut points on the beat ----------------------------------------------------------------
  const total = segments.reduce((s, x) => s + x.dur, 0);
  const g = grid(beats, total);
  if (!g.synthetic && (g.beats.at(-1) ?? 0) < total + 2) throw new Error(`${beats.file}: its beats run out ${(g.beats.at(-1) ?? 0).toFixed(1)} s into a ${total.toFixed(1)} s edit; use a longer track`);
  const bounds = [0];
  let nominal = 0;
  segments.forEach((s, i) => {
    nominal += s.dur;
    const next = segments[i + 1];
    // 'hit': a big moment lands on a jump in the music if one is within 2.5 s, else on a bar
    const hit = next?.snap === 'hit' && g.hits?.length ? nearest(g.hits, nominal) : null;
    const list = hit != null && Math.abs(hit - nominal) <= 2.5 ? [hit] : next && (next.snap === 'bar' || next.snap === 'hit') ? g.bars : g.beats;
    let b = next?.snap === false ? nominal : nearest(list, nominal);
    if (b - bounds.at(-1) < 0.6) b = nearest(g.beats.filter(x => x - bounds.at(-1) >= 0.6), nominal); // never a flash frame
    bounds.push(b);
    nominal = b; // later segments start from where this one really ended
  });
  const frameOf = sec => Math.round(sec * fps);

  // ---- shots ------------------------------------------------------------------------------------
  const clipsUsed = {};
  const shots = segments.map((s, i) => ({ s, id: s.id, start: frameOf(bounds[i]), end: frameOf(bounds[i + 1]) }))
    .map(x => ({ ...x, from: x.start, to: x.end }));
  shots.forEach((x, i) => { // centred transitions: the incoming shot starts early, the outgoing runs late
    const n = x.s.enter?.frames ?? 0;
    if (!n || !i) return;
    const half = Math.floor(n / 2);
    x.from -= half;
    shots[i - 1].to += n - half;
  });
  if (shots[0].s.enter) shots[0].from = 0;
  const panelMargin = Math.round(40 * scale), panelW = Math.round((H - 2 * panelMargin) * 9 / 16);

  const out = shots.map(x => {
    const s = x.s, n = x.to - x.from, offset = x.from - x.start;
    const shot = { id: s.id, kind: s.kind, from: x.from, to: x.to, start: x.start, end: x.end, enter: s.enter?.type ?? null, focus: s.focus ?? null, labels: s.labels ?? 'all' };
    if (s.dim) shot.dim = s.dim;
    if (s.sfx) shot.sfx = s.sfx;
    if (s.snap === false) shot.unsnapped = true; // its cut keeps the storyboard's time (a match cut), off the beat
    // race moves pinned on riders in the 3D picture (ATTACK, ↑/↓ for a pass, WINNER), in frames like the cues
    if (s.callouts) shot.callouts = s.callouts.map(c => ({ ...c, from: x.start + frameOf(c.at ?? 0), to: c.dur == null || c.dur === 'end' ? x.end : Math.min(x.end, x.start + frameOf((c.at ?? 0) + c.dur)) }));
    if (s.kind === '3d') {
      const t = mapFrames({ n, fps, ramp: s.time.speed, anchor: { value: s.time.t, at: s.time.at ?? 0 }, offset });
      shot.t = t.map(v => +Math.max(0, Math.min(model.duration, v)).toFixed(3));
      shot.cam = s.cam;
    } else if (s.kind === 'clip') {
      const c = sync.clips.find(v => v.file === s.file);
      const src = mapFrames({ n, fps, ramp: s.src.speed ?? 1, anchor: { value: s.src.s, at: s.src.at ?? 0 }, offset });
      const maxSrc = c.duration - 1.5 / c.fps;
      shot.src = src.map(v => +Math.max(0, Math.min(maxSrc, v)).toFixed(4));
      Object.assign(shot, { clip: s.file, rate: c.fps, blend: (typeof s.src.speed === 'number' ? s.src.speed : Math.min(...s.src.speed.map(k => k[1]))) < 0.9, zoom: s.zoom ?? null, focal: s.focal ?? [0.5, 0.5], audio: s.audio ?? 0 });
      const dirName = s.file.replace(/\.\w+$/, '');
      shot.dir = `/out/reel/clips/${dirName}/${preview ? 'preview' : 'full'}`;
      const first = Math.max(0, Math.floor(Math.min(...shot.src) * c.fps) - 1), last = Math.ceil(Math.max(...shot.src) * c.fps) + 1;
      shot.first = first; shot.last = Math.min(last, Math.floor(c.duration * c.fps) - 1);
      (clipsUsed[s.file] ??= { file: s.file, fps: c.fps, hdr: c.hdr, dir: dirName, ranges: [] }).ranges.push([shot.first, shot.last]);
      // race time over the clip, from the sync (none for clips off the climb)
      shot.raceT = c.raceT0 != null && c.kind !== 'off-route' ? shot.src.map(v => +(c.raceT0 + v).toFixed(3)) : null;
      // 9:16: the phone's own frame, full bleed. 16:9: a clip that carries data sits in a panel with the
      // graphics beside it ('data'); one without fills the frame over its own blurred footage ('blur').
      const dataCue = (s.cues ?? []).some(c => DATA_CUES.has(c.type));
      if (s.fit === 'bg') shot.fit = 'bg';
      else if (portrait) shot.fit = s.fit ?? 'cover';
      else if ((s.fit16 ?? (dataCue ? 'data' : 'blur')) === 'data') {
        shot.fit = 'data';
        shot.panel = { x: Math.round(84 * scale), y: panelMargin, w: panelW, h: H - 2 * panelMargin };
      } else shot.fit = 'blur';
    } else shot.color = s.color ?? '#0b0f0d';
    return shot;
  });

  // ---- graphics ------------------------------------------------------------------------------------
  const byId = Object.fromEntries(out.map(s => [s.id, s]));
  const cues = [];
  // A cue's own properties, without its storyboard timing (at/dur/from/to/skip), which become frames here.
  const cueProps = c => {
    const { type, at = 0, dur = 'end', from: _f, to: _t, skip: _s, atSrc: _a, ...props } = c;
    return { type, ...props };
  };
  out.forEach((shot, i) => {
    for (const c of segments[i].cues ?? []) {
      const from = shot.start + frameOf(c.at ?? 0);
      const to = c.dur === 'end' || c.dur == null ? shot.end : Math.min(shot.end, from + frameOf(c.dur));
      if (to > from) cues.push({ ...cueProps(c), from, to, seg: shot.id });
    }
  });
  for (const sp of spans) {
    const a = out.findIndex(s => s.id === sp.from), b = out.findIndex(s => s.id === sp.to);
    let runFrom = null;
    for (let k = a; k <= b + 1; k++) {
      const skip = k > b || sp.skip?.includes(out[k].id);
      if (!skip && runFrom == null) runFrom = out[k].start;
      if (skip && runFrom != null) { cues.push({ ...cueProps(sp), from: runFrom, to: out[k - 1].end }); runFrom = null; }
    }
  }
  // The race time each frame shows (the shot on top that has one).
  const frames = Math.max(...out.map(s => s.to));
  const raceT = Array(frames).fill(null);
  for (const s of out) {
    const t = s.kind === '3d' ? s.t : s.raceT;
    if (!t) continue;
    for (let f = s.from; f < s.to; f++) if (s.kind === '3d' || raceT[f] == null || f >= s.start) raceT[f] = t[f - s.from];
  }
  // A caption that names a place ("X leads") must stay true for its whole time on screen, in the held race
  // order, or it gives way to its neutral wording. (Live graphics, standings and rider cards, read the held order per frame.)
  for (const c of cues) {
    if (!c.claims) continue;
    const ts = raceT.slice(c.from, c.to).filter(v => v != null);
    const ok = ts.length && c.claims.every(k => model.holdsRank(k.rider, k.rank, Math.min(...ts), Math.max(...ts)));
    if (!ok) Object.assign(c, c.fallback ?? { head: '', sub: '' });
    c.claimsHeld = !!ok;
    if (!ok) delete c.claims; // a held claim stays on the cue, so it can be checked again (tests/reel.test.js)
    delete c.fallback;
  }
  const fades = [{ from: frames - frameOf(1.2), to: frames, dir: 'out' }];

  return {
    format, fps, w: W, h: H, frames, preview, scale,
    music: g.synthetic ? null : { file: beats.file, start: g.offset, tempo: beats.tempo },
    beatGrid: { synthetic: g.synthetic, cuts: bounds },
    beats: g.beats.filter(b => b <= frames / fps + 1), // reel seconds: graphics blink on them
    facts,
    shots: out, cues, raceT, fades,
    clips: Object.values(clipsUsed),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const format = args.includes('--format') ? args[args.indexOf('--format') + 1] : '9x16';
  const plan = makePlan({ format, preview: args.includes('--preview') });
  mkdirSync(WORK, { recursive: true });
  const file = `${WORK}/plan-${format}${plan.preview ? '-preview' : ''}.json`;
  writeFileSync(file, JSON.stringify(plan));
  console.log(`${file}: ${plan.frames} frames (${(plan.frames / plan.fps).toFixed(1)} s), ${plan.shots.length} shots, ${plan.cues.length} graphics${plan.beatGrid.synthetic ? ', placeholder 120 BPM grid' : ''}`);
  for (const s of plan.shots) console.log(`  ${String(s.start).padStart(5)}–${String(s.end).padEnd(5)} ${s.kind.padEnd(4)} ${s.id.padEnd(14)} ${s.clip ?? s.cam?.type ?? ''} ${s.enter ?? ''}`);
}

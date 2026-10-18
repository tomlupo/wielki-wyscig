// The reel renderer: one deterministic frame at a time, driven by scripts/reel/render.mjs.
//
// The page builds the same 3D world as the app (no UI), then composites each output frame
// from the plan (scripts/reel/plan.mjs): 3D shots on a scripted camera, phone-clip frames
// (pre-extracted by ffmpeg), transitions, and the broadcast graphics. Time never comes from
// the wall clock: frame f is race time plan.raceT[f], camera time f / fps.
import { clock } from './clock.js';
import { loadRace } from '../data/source.js';
import { createWorld } from '../world.js';
import { buildModel } from './model.js';
import { createCameras } from './camera.js';
import { createOverlay, easeOut, easeInOut, clamp01, GOLD } from './overlay.js';

const q = new URLSearchParams(location.search);
const W = Number(q.get('w')) || 1080, H = Number(q.get('h')) || 1920;
const $ = id => document.getElementById(id);

const FONTS = [['500', 'bc-500', 'U+0000-00FF, U+2000-206F, U+2191, U+2193, U+2212'], ['600', 'bc-600', 'U+0000-00FF, U+2000-206F, U+2191, U+2193, U+2212'],
  ['700', 'bc-700', 'U+0000-00FF, U+2000-206F, U+2191, U+2193, U+2212'], ['600', 'bc-600-ext', 'U+0100-024F'], ['700', 'bc-700-ext', 'U+0100-024F']];

window.reel = { ready: boot() };

async function boot() {
  for (const [weight, file, unicodeRange] of FONTS) document.fonts.add(await new FontFace('Barlow Condensed', `url(/fonts/${file}.woff2)`, { weight, unicodeRange }).load());
  const stage = $('stage');
  Object.assign(stage.style, { width: `${W}px`, height: `${H}px` });
  const out = $('out');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d', { alpha: false });

  const [terrain, race] = await Promise.all([fetch('/terrain.json').then(r => r.json()), loadRace()]);
  const model = buildModel(race, terrain.route);
  const world = await createWorld({ container: stage, labels: $('labels'), terrain, race: { ...race, riders: model.riders }, onSelect() {}, onPageDrag() { return false; } });
  world.holdQuality();
  await world.ready;
  await world.detailReady; // the trees and the road-imagery index: in every frame from the first
  const glCanvas = stage.querySelector('canvas');
  const cameras = createCameras(world, model);
  const overlay = createOverlay(ctx, { W, H, model });
  const layers = [document.createElement('canvas'), document.createElement('canvas')].map(c => { c.width = W; c.height = H; return c; });
  const grain = makeGrain(256);

  let plan = null;
  const fromPose = new Map(); // flyto start poses, per shot

  // ---- clip frames: decoded images, cached, prefetched ---------------------------------------
  const cache = new Map();
  function image(url) {
    let p = cache.get(url);
    if (!p) {
      p = new Promise((resolve, reject) => { const img = new Image(); img.onload = () => img.decode().then(() => resolve(img), reject); img.onerror = () => reject(new Error(`missing ${url}`)); img.src = url; });
      cache.set(url, p);
      if (cache.size > 160) cache.delete(cache.keys().next().value);
    }
    return p;
  }
  const frameUrl = (shot, n) => `${shot.dir}/${String(n).padStart(6, '0')}.jpg`;
  function clipFrames(shot, f) {
    const s = shot.src[f - shot.from] * shot.rate; // source frame, fractional
    const a = Math.max(shot.first, Math.min(shot.last, Math.floor(s)));
    const b = Math.min(shot.last, a + 1), mix = shot.blend ? s - Math.floor(s) : 0;
    return { a, b, mix };
  }

  // ---- 3D --------------------------------------------------------------------------------------
  const distancesAt = t => model.riders.map((_, i) => model.distance(i, t));
  function camCtx(shot, f) {
    const k = f - shot.from, t = shot.t[k];
    return { t, d: distancesAt(t), sec: k / plan.fps, u: shot.to - shot.from > 1 ? k / (shot.to - shot.from - 1) : 1, frame: f };
  }
  function poseOf(shot, f) {
    const spec = shot.cam;
    if (spec.type === 'flyto' && !spec.from) {
      if (!fromPose.has(shot.id)) {
        const prev = plan.shots.find(s => s.id === spec.after);
        fromPose.set(shot.id, prev ? poseOf(prev, prev.to - 1) : null);
      }
      return cameras.pose({ ...spec, from: fromPose.get(shot.id) }, camCtx(shot, f));
    }
    return cameras.pose(spec, camCtx(shot, f));
  }
  let lastInset = 0;
  async function render3d(shot, f, layer) {
    const c = camCtx(shot, f), pose = poseOf(shot, f);
    const inset = shot.inset ?? 0;
    if (inset !== lastInset) { world.setInsetRight(inset); lastInset = inset; }
    world.setDirectCamera(() => pose);
    if (shot.focus != null) world.select(shot.focus); // the road imagery and detail load around the shot's rider
    const next = shot.t[Math.min(shot.t.length - 1, f - shot.from + 1)];
    const rate = Math.max(0, (next - c.t) * plan.fps);
    const args = { time: c.t, distances: c.d, playing: true, rate };
    if (f === shot.from) world.frame(args); // settle level-of-detail and trails after a cut
    world.frame(args);
    // A road tile still loading: wait for it and draw the frame again, so every frame shows the sharp ground.
    if (world.tilesPending()) {
      for (let k = 0; k < 400 && world.tilesPending(); k++) await new Promise(r => setTimeout(r, 15));
      world.frame(args);
    }
    const g = layer.getContext('2d');
    g.drawImage(glCanvas, 0, 0, W, H);
    if (shot.labels !== 'none') drawLabels(g, shot, c);
  }
  // Rider labels over the 3D picture, as the app draws them: a helmet-colour dot (a ring where two riders share the
  // colour); the name for the focus rider.
  function drawLabels(g, shot, c) {
    const cam = world.camera, items = [];
    model.riders.forEach((r, i) => {
      const p = world.riderPosition(i).clone();
      p.y += 11;
      p.project(cam);
      if (p.z >= 1 || Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05) return;
      items.push({ i, x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H, focus: i === shot.focus || (shot.labels === 'names') });
    });
    const S = overlay.S;
    // A bunch would stack its labels into an unreadable pile: the first label of a pile stands for it with "+N"
    // (the shot's own rider claims a place first, then named riders, then riders by race position).
    const order = model.orderAt(c.t);
    items.sort((a, b) => (b.i === shot.focus) - (a.i === shot.focus) || b.focus - a.focus || order.indexOf(a.i) - order.indexOf(b.i));
    const placed = [];
    g.save(); g.font = `700 ${Math.round(26 * S)}px "Barlow Condensed"`;
    for (const it of items) {
      const nameW = it.focus ? g.measureText(model.riders[it.i].name.toUpperCase()).width + 22 * S : 0;
      it.h = (it.focus ? 48 : 40) * S; it.w = it.h + nameW; it.more = 0;
      const host = placed.find(p => Math.abs(p.x - it.x) < (p.w + it.w) / 2 + 4 * S && Math.abs(p.y - it.y) < (p.h + it.h) / 2 + 2 * S);
      if (host) { host.more++; continue; }
      placed.push(it);
    }
    g.restore();
    for (const it of placed.reverse()) {
      const r = model.riders[it.i], small = !it.focus;
      g.save();
      g.font = `700 ${Math.round(26 * S)}px "Barlow Condensed"`;
      const more = it.more ? `+${it.more}` : '', moreW = more ? g.measureText(more).width + 14 * S : 0;
      const h = it.h, w = it.w + moreW, x = it.x - w / 2, y = it.y - h - 12 * S;
      g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 14 * S;
      g.beginPath(); g.roundRect(x, y, w, h, h / 2); g.fillStyle = 'rgba(12,16,14,0.88)'; g.fill();
      g.shadowColor = 'transparent';
      g.lineWidth = (small ? 2 : 3) * S; g.strokeStyle = r.color; g.stroke();
      g.beginPath(); g.moveTo(it.x - 7 * S, y + h); g.lineTo(it.x + 7 * S, y + h); g.lineTo(it.x, y + h + 10 * S); g.closePath(); g.fillStyle = r.color; g.fill();
      const cr = h / 2 - 6 * S;
      g.beginPath();
      if (r.ring) { g.arc(x + h / 2, y + h / 2, cr * 0.78, 0, Math.PI * 2); g.lineWidth = cr * 0.44; g.strokeStyle = r.color; g.stroke(); }
      else { g.arc(x + h / 2, y + h / 2, cr, 0, Math.PI * 2); g.fillStyle = r.color; g.fill(); }
      g.textBaseline = 'middle';
      if (!small) { g.fillStyle = '#f4f2ea'; g.textAlign = 'left'; g.font = `700 ${Math.round(26 * S)}px "Barlow Condensed"`; g.letterSpacing = `${0.8 * S}px`; g.fillText(r.name.toUpperCase(), x + h + 2 * S, y + h / 2 + 1); }
      if (more) { g.fillStyle = '#a9b2a7'; g.textAlign = 'left'; g.font = `700 ${Math.round(24 * S)}px "Barlow Condensed"`; g.letterSpacing = '0px'; g.fillText(more, x + it.w - 4 * S, y + h / 2 + 1); }
      g.restore();
    }
  }

  // ---- clips -------------------------------------------------------------------------------------
  async function renderClip(shot, f, layer) {
    const g = layer.getContext('2d');
    const { a, b, mix } = clipFrames(shot, f);
    const [ia, ib] = await Promise.all([image(frameUrl(shot, a)), mix > 0.02 ? image(frameUrl(shot, b)) : null]);
    for (let k = 1; k <= 6; k++) if (f + k < shot.to) { const n = clipFrames(shot, f + k); image(frameUrl(shot, n.a)).catch(() => {}); }
    const k = f - shot.from, u = shot.to - shot.from > 1 ? k / (shot.to - shot.from - 1) : 0;
    const zoom = shot.zoom ? shot.zoom[0] + (shot.zoom[1] - shot.zoom[0]) * easeInOut(u) : 1;
    if (shot.fit === 'panel') {
      if (shot.cam) await render3d(shot, f, layer); else { g.fillStyle = '#0b0f0d'; g.fillRect(0, 0, W, H); }
      const ph = H - 2 * shot.panel.margin, pw = ph * ia.width / ia.height, px = W - shot.panel.margin - pw, py = shot.panel.margin;
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 40; g.shadowOffsetX = -8;
      g.beginPath(); g.roundRect(px, py, pw, ph, 22); g.fillStyle = '#000'; g.fill();
      g.shadowColor = 'transparent';
      g.clip();
      drawCover(g, ia, ib, mix, px, py, pw, ph, zoom, shot.focal);
      g.restore();
      g.lineWidth = 3; g.strokeStyle = 'rgba(255,211,77,0.9)'; g.beginPath(); g.roundRect(px, py, pw, ph, 22); g.stroke();
      return;
    }
    if (shot.fit === 'bg') { // real footage as a soft backdrop for a full-screen graphic
      g.save(); g.filter = 'blur(26px) saturate(1.1)';
      drawCover(g, ia, ib, mix, -50, -50, W + 100, H + 100, zoom * 1.06, shot.focal);
      g.restore();
      return;
    }
    if (shot.fit === 'data') { // 16:9: the phone clip in a panel on the left over its own blurred footage, the data beside it
      g.save(); g.filter = 'blur(36px) brightness(0.42) saturate(1.15)';
      drawCover(g, ia, null, 0, -60, -60, W + 120, H + 120, 1.12, shot.focal);
      g.restore();
      const { x: px, y: py, w: pw, h: ph } = shot.panel;
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 50; g.shadowOffsetY = 10;
      g.beginPath(); g.roundRect(px, py, pw, ph, 20); g.fillStyle = '#000'; g.fill();
      g.shadowColor = 'transparent'; g.clip();
      drawCover(g, ia, ib, mix, px, py, pw, ph, zoom, shot.focal);
      g.restore();
      g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.16)'; g.beginPath(); g.roundRect(px, py, pw, ph, 20); g.stroke();
      return;
    }
    if (shot.fit === 'blur') {
      g.save(); g.filter = 'blur(40px) brightness(0.55) saturate(1.2)';
      drawCover(g, ia, null, 0, -60, -60, W + 120, H + 120, 1.1, shot.focal);
      g.restore();
      const ph = H, pw = ph * ia.width / ia.height;
      drawCover(g, ia, ib, mix, (W - pw) / 2, 0, pw, ph, zoom, shot.focal);
      return;
    }
    drawCover(g, ia, ib, mix, 0, 0, W, H, zoom, shot.focal);
  }
  function drawCover(g, ia, ib, mix, x, y, w, h, zoom = 1, focal = [0.5, 0.5]) {
    const s = Math.max(w / ia.width, h / ia.height) * zoom, sw = w / s, sh = h / s;
    const sx = Math.max(0, Math.min(ia.width - sw, focal[0] * ia.width - sw / 2)), sy = Math.max(0, Math.min(ia.height - sh, focal[1] * ia.height - sh / 2));
    g.drawImage(ia, sx, sy, sw, sh, x, y, w, h);
    if (ib && mix > 0.02) { g.save(); g.globalAlpha = mix; g.drawImage(ib, sx, sy, sw, sh, x, y, w, h); g.restore(); }
  }

  // ---- compositing -----------------------------------------------------------------------------------
  async function renderShot(shot, f, layer) {
    const g = layer.getContext('2d');
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.filter = 'none';
    if (shot.kind === '3d') await render3d(shot, f, layer);
    else if (shot.kind === 'clip') await renderClip(shot, f, layer);
    else { g.fillStyle = shot.color ?? '#0b0f0d'; g.fillRect(0, 0, W, H); }
    if (shot.dim) { g.fillStyle = `rgba(6,9,8,${shot.dim})`; g.fillRect(0, 0, W, H); } // under a full-screen graphic
    g.restore();
  }
  // How the incoming shot B covers A during their overlap; p goes 0 → 1.
  function blend(type, A, B, p) {
    ctx.drawImage(A, 0, 0);
    ctx.save();
    switch (type) {
      case 'fade': ctx.globalAlpha = easeInOut(p); ctx.drawImage(B, 0, 0); break;
      case 'flash': { // white burst at the cut
        if (p >= 0.5) ctx.drawImage(B, 0, 0);
        ctx.globalAlpha = (1 - Math.abs(p - 0.5) * 2) ** 1.5 * 0.85; ctx.fillStyle = '#fff'; ctx.globalCompositeOperation = 'screen'; ctx.fillRect(0, 0, W, H);
        break;
      }
      case 'dip': { // through black
        if (p >= 0.5) ctx.drawImage(B, 0, 0);
        ctx.globalAlpha = 1 - Math.abs(p - 0.5) * 2; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        break;
      }
      case 'wipe': { // a gold scan line sweeps up and reveals the next shot: 3D twin ↔ reality
        const e = easeInOut(p), y = H * (1 - e);
        ctx.beginPath(); ctx.rect(0, y, W, H - y); ctx.clip(); ctx.drawImage(B, 0, 0); ctx.restore(); ctx.save();
        const g = ctx.createLinearGradient(0, y - 60, 0, y + 60);
        g.addColorStop(0, 'rgba(255,211,77,0)'); g.addColorStop(0.5, 'rgba(255,211,77,0.95)'); g.addColorStop(1, 'rgba(255,211,77,0)');
        ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = g; ctx.fillRect(0, y - 60, W, 120);
        ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(0, y - 2, W, 4);
        break;
      }
      case 'zoom': { // punch in on A, then B lands from a slight overscale with a blur of motion
        const e = easeInOut(p);
        if (p < 0.5) { const s = 1 + e * 0.35; ctx.filter = `blur(${e * 14}px)`; ctx.drawImage(A, W / 2 - W * s / 2, H / 2 - H * s / 2, W * s, H * s); }
        else { const s = 1 + (1 - e) * 0.35; ctx.filter = `blur(${(1 - e) * 14}px)`; ctx.drawImage(B, W / 2 - W * s / 2, H / 2 - H * s / 2, W * s, H * s); }
        break;
      }
      case 'whip': { // a fast sideways pan with motion blur
        const e = easeInOut(p), dx = W * e;
        ctx.filter = `blur(${Math.sin(Math.PI * p) * 26}px)`;
        ctx.drawImage(A, -dx, 0); ctx.drawImage(B, W - dx, 0);
        break;
      }
      default: ctx.drawImage(B, 0, 0);
    }
    ctx.restore();
  }

  function finish(f) {
    // One grade for 3D and phone footage alike: a soft vignette and a breath of film grain.
    const v = ctx.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.hypot(W, H) * 0.62);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalAlpha = 0.035; ctx.globalCompositeOperation = 'overlay';
    const ox = (f * 73) % 256, oy = (f * 151) % 256;
    ctx.fillStyle = ctx.createPattern(grain, 'repeat'); ctx.translate(-ox, -oy); ctx.fillRect(ox, oy, W, H);
    ctx.restore();
  }

  function cueEnv(cue, f) {
    const t = cue.t != null ? cue.t : plan.raceT[f];
    const history = [];
    if (cue.type === 'standings') for (let k = 0; k < 12; k++) { const tf = plan.raceT[Math.max(cue.from, f - k)]; if (tf != null) history.push(model.orderAt(tf)); }
    return { f, since: (f - cue.from) / plan.fps, until: (cue.to - 1 - f) / plan.fps, t, history };
  }

  async function frame(f) {
    clock.set(f * 1000 / plan.fps);
    const live = plan.shots.filter(s => f >= s.from && f < s.to);
    if (!live.length) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
    else if (live.length === 1) { await renderShot(live[0], f, layers[0]); ctx.drawImage(layers[0], 0, 0); }
    else {
      const [A, B] = live.slice(-2);
      await renderShot(A, f, layers[0]);
      await renderShot(B, f, layers[1]);
      const p = clamp01((f - B.from + 0.5) / Math.max(1, Math.min(A.to, B.to) - B.from));
      blend(B.enter ?? 'fade', layers[0], layers[1], p);
    }
    if (!plan.raw) finish(f);
    const top = live.at(-1);
    overlay.setArea(top?.fit === 'data' ? { x: top.panel.x + top.panel.w + 64 * overlay.S, right: W - 72 * overlay.S } : null);
    for (const cue of plan.cues) if (f >= cue.from && f < cue.to) overlay.draw(cue, cueEnv(cue, f));
    // global fades
    for (const fade of plan.fades ?? []) if (f >= fade.from && f < fade.to) {
      const p = (f - fade.from) / (fade.to - fade.from), a = fade.dir === 'in' ? 1 - p : p;
      ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(0, 0, W, H);
    }
  }

  return {
    W, H, model, world,
    gpu: (() => { const gl = glCanvas.getContext('webgl2'); const ext = gl?.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'; })(),
    load(p) {
      plan = p; fromPose.clear(); cache.clear();
      // Settle each camera's free choices (road side, swing) from the race at the shot's start, middle and end.
      for (const s of plan.shots) if (s.cam && s.t) s.cam = cameras.resolve(s.cam, [s.start ?? s.from, Math.round((s.from + s.to) / 2), s.to - 1].map(f => camCtx(s, f)));
    },
    async frame(f, { type = 'image/jpeg', quality = 0.93 } = {}) { await frame(f); return out.toDataURL(type, quality); },
    async still(shot, f) { plan ??= { fps: 30, shots: [], cues: [], raceT: [] }; await renderShot(shot, f, layers[0]); ctx.drawImage(layers[0], 0, 0); return out.toDataURL('image/jpeg', 0.92); },
  };
}

// A tile of soft noise for the grain (deterministic: a fixed LCG, not Math.random).
function makeGrain(n) {
  const c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), img = g.createImageData(n, n);
  let s = 12345;
  for (let i = 0; i < n * n; i++) { s = (s * 1664525 + 1013904223) >>> 0; const v = 128 + ((s >>> 24) - 128) * 0.9; img.data.set([v, v, v, 255], i * 4); }
  g.putImageData(img, 0, 0);
  return c;
}

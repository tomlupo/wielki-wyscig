// Broadcast graphics for the reel, drawn on the output canvas in the app's look
// (Barlow Condensed, ink on dark glass, gold accents, rider colours). Every graphic is a
// pure function of the frame: what to draw comes from the plan's cues, the numbers from
// the race at that frame's race time.
import { formatClock, formatGap, telemetryAt, timeAtDistance, interpolate, gradeAt, ORDINAL } from './model.js';
import { gradeColor } from '../profile.js';

export const INK = '#f4f2ea', DIM = '#a9b2a7', FAINT = '#6f786e', GOLD = '#ffd34d', RED = '#ff4d5a';
const GLASS = 'rgba(12,16,14,0.80)', LINE = 'rgba(255,255,255,0.12)';
const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';

export const easeOut = u => 1 - (1 - u) ** 3;
export const easeIn = u => u ** 3;
export const easeInOut = u => u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
export const clamp01 = u => Math.max(0, Math.min(1, u));
const lerp = (a, b, u) => a + (b - a) * u;

export function createOverlay(ctx, { W, H, model }) {
  const S = Math.min(W, H) / 1080; // one design unit
  const portrait = H > W;
  // Safe area: phone apps cover the top ~11% and the bottom ~20% of a 9:16 frame, and a column on the right.
  const L0 = portrait
    ? { x: 64 * S, top: 200 * S, bottom: H - 400 * S, right: W - 64 * S, rightLow: W - 150 * S }
    : { x: 80 * S, top: 64 * S, bottom: H - 64 * S, right: W - 80 * S, rightLow: W - 80 * S };
  const L = { ...L0 }; // per frame: a 16:9 data layout narrows it to the column beside the phone clip
  const { riders } = model;

  const font = (w, px) => `${w} ${Math.round(px * S)}px ${FONT}`;
  function text(str, x, y, { w = 700, px = 30, color = INK, align = 'left', spacing = 0, base = 'alphabetic', alpha = 1, shadow = 0 } = {}) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.font = font(w, px);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = base;
    ctx.letterSpacing = `${spacing * px * S}px`;
    if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = shadow * S; ctx.shadowOffsetY = 2 * S; }
    ctx.fillText(str, x, y);
    const width = ctx.measureText(str).width;
    ctx.restore();
    return width;
  }
  function measure(str, w, px, spacing = 0) {
    ctx.save(); ctx.font = font(w, px); ctx.letterSpacing = `${spacing * px * S}px`;
    const m = ctx.measureText(str).width; ctx.restore(); return m;
  }
  // Digits on a fixed grid so a running clock does not wobble (canvas has no tabular-nums).
  function num(str, x, y, { w = 700, px = 40, color = INK, align = 'left', alpha = 1 } = {}) {
    ctx.save(); ctx.globalAlpha *= alpha; ctx.font = font(w, px); ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
    const cell = ctx.measureText('0').width;
    const widths = [...str].map(ch => /\d/.test(ch) ? cell : ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0);
    let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
    [...str].forEach((ch, k) => { ctx.textAlign = 'center'; ctx.fillText(ch, cx + widths[k] / 2, y); cx += widths[k]; });
    ctx.restore();
    return total;
  }
  function panel(x, y, w, h, { r = 18, fill = GLASS, accent = null, alpha = 1, line = true } = {}) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 30 * S; ctx.shadowOffsetY = 10 * S;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r * S); ctx.fillStyle = fill; ctx.fill();
    ctx.shadowColor = 'transparent';
    if (line) { ctx.lineWidth = 1.5 * S; ctx.strokeStyle = LINE; ctx.stroke(); }
    if (accent) { ctx.save(); ctx.clip(); ctx.fillStyle = accent; ctx.fillRect(x, y, 5 * S, h); ctx.restore(); }
    ctx.restore();
  }
  function dot(cx, cy, r, color, letter, { ring = 0, alpha = 1 } = {}) {
    ctx.save(); ctx.globalAlpha *= alpha;
    if (ring) { ctx.beginPath(); ctx.arc(cx, cy, r + ring * S, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill(); }
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    if (letter) { ctx.font = `700 ${Math.round(r * 1.25)}px ${FONT}`; ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(letter, cx, cy + r * 0.08); }
    ctx.restore();
  }
  // In/out envelope of a cue: 0 → 1 over `inS`, 1 → 0 over the last `outS` seconds.
  const env = (e, inS = 0.45, outS = 0.3) => ({ i: easeOut(clamp01(e.since / inS)), o: easeIn(clamp01(e.until / outS)) });
  const vis = (e, inS, outS) => { const k = env(e, inS, outS); return Math.min(k.i, k.o); };

  const name = i => riders[i].name.toUpperCase();
  // Gaps down the (held) order never shrink: two riders swapping places show the same gap until the swap holds.
  const gapTexts = t => {
    const order = model.orderAt(t), out = {};
    let floor = 0;
    order.forEach((i, k) => {
      const fin = t >= riders[i].finish;
      const raw = fin ? riders[i].finish - riders[order[0]].finish : model.gapToLeader(i, t);
      floor = Math.max(floor, raw);
      out[i] = k === 0 ? (fin ? formatClock(riders[i].finish) : 'LEADER') : formatGap(floor);
    });
    return out;
  };

  // ---------------------------------------------------------------------------------------------
  const G = {
    // Top-left: the race bug. Gold kicker, race clock with a live dot, km to go of the head of the race.
    bug(c, e) {
      const a = vis(e), t = e.t;
      if (a <= 0 || t == null) return;
      const x = L.x - (1 - env(e).i) * 40 * S, y = L.top;
      ctx.save(); ctx.globalAlpha = a;
      text('WIELKI WYŚCIG', x, y + 26 * S, { w: 600, px: 24, color: GOLD, spacing: 0.24, shadow: 12 });
      const lead = model.orderAt(t)[0], dLead = model.distance(lead, Math.min(t, riders[lead].finish));
      const togo = Math.max(0, (model.len - dLead) / 1000);
      const w1 = measure('8:88:88', 700, 64);
      panel(x, y + 44 * S, w1 + 210 * S, 92 * S, { r: 16 });
      const live = 0.55 + 0.45 * Math.sin(e.f / 30 * Math.PI * 1.6);
      ctx.beginPath(); ctx.arc(x + 30 * S, y + 90 * S, 9 * S, 0, Math.PI * 2); ctx.fillStyle = RED; ctx.globalAlpha = a * live; ctx.fill(); ctx.globalAlpha = a;
      num(formatClock(Math.min(t, model.duration)), x + 54 * S, y + 113 * S, { px: 64 });
      const tx = x + 54 * S + w1 + 26 * S;
      ctx.fillStyle = LINE; ctx.fillRect(tx - 14 * S, y + 62 * S, 1.5 * S, 56 * S);
      num(togo.toFixed(1), tx, y + 100 * S, { px: 40 });
      text('KM TO GO', tx, y + 124 * S, { w: 600, px: 18, color: DIM, spacing: 0.14 });
      ctx.restore();
    },

    // The rider card, as the app's focus card: name, place, power, heart rate, speed, grade, km to go.
    rider(c, e) {
      const a = vis(e), t = e.t, i = c.rider;
      if (a <= 0 || t == null) return;
      const r = riders[i], order = model.orderAt(t), rank = order.indexOf(i) + 1, fin = t >= r.finish;
      const tel = telemetryAt(r.samples, t), d = model.distance(i, t);
      const w = Math.min(portrait ? W - 2 * L.x : 760 * S, L.right - L.x), h = 210 * S;
      const x = c.x ?? L.x, y0 = c.y != null ? c.y * H : (portrait ? L.top + 170 * S : L.top + 160 * S);
      const y = y0 + (1 - env(e).i) * 30 * S;
      ctx.save(); ctx.globalAlpha = a;
      panel(x, y, w, h, { accent: r.color });
      dot(x + 52 * S, y + 52 * S, 26 * S, r.color, r.letter);
      text(name(i), x + 94 * S, y + 52 * S, { px: 40, spacing: 0.03 });
      const place = fin ? `FINISHED ${ORDINAL(rank).toUpperCase()} · ${formatClock(r.finish)}` : rank === 1 ? 'P1 · LEADING' : `P${rank} · ${gapTexts(t)[i]}`;
      text(place, x + 94 * S, y + 84 * S, { w: 500, px: 28, color: DIM, spacing: 0.04 });
      num(((model.len - d) / 1000).toFixed(2), x + w - 28 * S, y + 62 * S, { px: 48, align: 'right' });
      text('KM TO GO', x + w - 28 * S, y + 86 * S, { w: 500, px: 18, color: DIM, align: 'right', spacing: 0.14 });
      ctx.fillStyle = LINE; ctx.fillRect(x + 28 * S, y + 110 * S, w - 56 * S, 1.5 * S);
      const grade = gradeAt(model.route, d, 200);
      const stats = [
        ['POWER', fin || tel.watts == null ? '—' : String(tel.watts), 'W', INK],
        ['HEART', fin || tel.hr == null ? '—' : String(tel.hr), 'bpm', INK],
        ['SPEED', fin || tel.speed == null ? '—' : tel.speed.toFixed(1), 'km/h', INK],
        ['GRADE', fin ? '—' : grade.toFixed(1), '%', `rgb(${gradeColor(grade)})`],
      ];
      const cw = (w - 56 * S) / 4;
      stats.forEach(([label, value, unit, color], k) => {
        const cx = x + 28 * S + k * cw + (k ? 18 * S : 0);
        if (k) { ctx.fillStyle = LINE; ctx.fillRect(x + 28 * S + k * cw, y + 126 * S, 1.5 * S, 62 * S); }
        text(label, cx, y + 140 * S, { w: 600, px: 17, color: DIM, spacing: 0.16 });
        const vw = num(value, cx, y + 186 * S, { px: 46, color });
        text(unit, cx + vw + 5 * S, y + 186 * S, { w: 500, px: 20, color: DIM });
      });
      ctx.restore();
    },

    // Standings: rank, colour, name, gap. Rows glide to their new place when the (held) order changes.
    standings(c, e) {
      const a = vis(e, 0.5, 0.35), t = e.t;
      if (a <= 0 || t == null) return;
      const n = c.top ?? riders.length, rowH = (c.rowH ?? 50) * S, w = (c.w ?? 420) * S;
      const x = c.x ?? L.x, y = c.y ?? (portrait ? L.top + 170 * S : L.top + 160 * S);
      // Each rider's displayed rank: the mean of its rank over the last ~0.4 s of screen time (a slide, frame-pure).
      const past = e.history; // [order at f, f-1, ...]
      const rankOf = i => { let s = 0, ws = 0; past.forEach((o, k) => { const wk = 1 - k / past.length; s += o.indexOf(i) * wk; ws += wk; }); return s / ws; };
      const order = model.orderAt(t), gaps = gapTexts(t);
      ctx.save(); ctx.globalAlpha = a;
      const head = 54 * S;
      panel(x, y, w, head + rowH * n + 14 * S, { r: 16 });
      text(c.title ?? 'STANDINGS', x + 24 * S, y + 36 * S, { w: 600, px: 20, color: GOLD, spacing: 0.22 });
      ctx.save(); ctx.beginPath(); ctx.rect(x, y + head - 4 * S, w, rowH * n + 8 * S); ctx.clip();
      riders.forEach((r, i) => {
        const rk = rankOf(i);
        if (rk > n - 0.01 && order.indexOf(i) >= n) return;
        const ry = y + head + rk * rowH, k = Math.round(rk);
        const slide = (1 - easeOut(clamp01((e.since - 0.06 * k) / 0.5))) * 60 * S; // rows cascade in
        // mid-swap: the rider moving up steps out to the right as they pass, the one dropping back dims
        const frac = Math.abs(rk - order.indexOf(i)), up = order.indexOf(i) < rk - 0.01;
        const pass = frac > 0.02 ? Math.sin(Math.min(1, frac) * Math.PI) : 0;
        const rx = x + slide + (up ? pass * 26 * S : 0), ra = clamp01((e.since - 0.06 * k) / 0.35) * (up ? 1 : 1 - 0.45 * pass);
        ctx.globalAlpha = a * ra;
        num(String(order.indexOf(i) + 1), rx + 34 * S, ry + rowH * 0.66, { px: 28, color: order[0] === i ? GOLD : DIM, align: 'right' });
        dot(rx + 66 * S, ry + rowH * 0.5, 15 * S, r.color, r.letter);
        text(name(i), rx + 92 * S, ry + rowH * 0.66, { w: 600, px: 27, spacing: 0.03 });
        const g = gaps[i];
        text(g, x + w - 22 * S, ry + rowH * 0.66, { w: 600, px: 26, color: g === 'LEADER' ? GOLD : DIM, align: 'right' });
      });
      ctx.restore();
      ctx.restore();
    },

    // The elevation profile with every rider's dot, the climb colour-coded by grade.
    profile(c, e) {
      const a = vis(e, 0.5, 0.35), t = e.t;
      if (a <= 0 || t == null) return;
      const prof = model.profile, len = model.len;
      const w = c.w ?? Math.min(portrait ? W - 2 * L.x : 1100 * S, L.right - L.x), h = (c.h ?? 170) * S;
      const x = c.x ?? (portrait || L.area ? L.x : (W - w) / 2), y = (c.y != null ? c.y * H : (portrait ? L.bottom - h - 20 * S : L.bottom - h)) + (1 - env(e).i) * 40 * S;
      const lo = Math.min(...prof.map(p => p.ele)), hi = Math.max(...prof.map(p => p.ele));
      const top = y + 44 * S, bot = y + h - 30 * S;
      const X = d => x + 20 * S + d / len * (w - 40 * S), E = el => bot - (el - lo) / (hi - lo) * (bot - top);
      ctx.save(); ctx.globalAlpha = a;
      panel(x, y, w, h, { r: 16 });
      const grad = ctx.createLinearGradient(X(0), 0, X(len), 0);
      for (let k = 0; k < prof.length; k += 4) grad.addColorStop(prof[k].d / len, `rgba(${gradeColor(prof[k].grade)},0.75)`);
      // Reveal along the climb as the cue comes in.
      const reveal = c.reveal ? easeInOut(clamp01(e.since / 1.2)) : 1;
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, 20 * S + reveal * (w - 40 * S), h); ctx.clip();
      ctx.beginPath(); ctx.moveTo(X(0), bot);
      for (const p of prof) ctx.lineTo(X(p.d), E(p.ele));
      ctx.lineTo(X(len), bot); ctx.closePath();
      ctx.fillStyle = grad; ctx.globalAlpha = a * 0.55; ctx.fill(); ctx.globalAlpha = a;
      ctx.beginPath(); prof.forEach((p, k) => k ? ctx.lineTo(X(p.d), E(p.ele)) : ctx.moveTo(X(p.d), E(p.ele)));
      ctx.strokeStyle = 'rgba(244,242,234,0.85)'; ctx.lineWidth = 2.5 * S; ctx.stroke();
      ctx.restore();
      text(`${Math.round(prof[0].ele)} M`, x + 20 * S, y + 32 * S, { w: 600, px: 19, color: DIM, spacing: 0.1 });
      text(`${Math.round(prof.at(-1).ele)} M`, x + w - 20 * S, y + 32 * S, { w: 600, px: 19, color: DIM, spacing: 0.1, align: 'right' });
      text(c.label ?? 'CAIMARI → COLL DE SA BATALLA', x + w / 2, y + 32 * S, { w: 600, px: 19, color: GOLD, spacing: 0.2, align: 'center' });
      for (let k = 1; k * 1000 < len; k++) text(String(k), X(k * 1000), y + h - 8 * S, { w: 600, px: 17, color: FAINT, align: 'center' });
      // Riders: dots on the line; the focus rider gets a guide line and a ring.
      const eleAt = d => { const k = Math.min(prof.length - 1, Math.max(0, Math.round(d / (prof[1].d - prof[0].d)))); return prof[k].ele; };
      const order = model.orderAt(t).slice().reverse(); // leader drawn last
      if (c.focus != null) {
        const fx = X(model.distance(c.focus, t));
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(fx - S, top - 8 * S, 2 * S, bot - top + 8 * S);
      }
      for (const i of order) {
        const d = model.distance(i, t), focus = i === c.focus;
        dot(X(d), E(eleAt(d)) - 2 * S, (focus ? 17 : 13) * S, riders[i].color, riders[i].letter, { ring: focus ? 3 : 0 });
      }
      ctx.restore();
    },

    // A broadcast lower third for a race event.
    event(c, e) {
      const a = vis(e, 0.4, 0.3);
      if (a <= 0) return;
      const color = c.rider != null ? riders[c.rider].color : GOLD;
      const x = L.x, y = c.y ?? (portrait ? L.bottom - 430 * S : L.bottom - 330 * S);
      const wipe = easeOut(clamp01(e.since / 0.5));
      const head = c.head.toUpperCase(), sub = c.sub ?? '';
      const w = Math.max(measure(head, 700, 64) + 70 * S, measure(sub, 500, 30) + 70 * S, measure(c.kicker ?? '', 600, 22, 0.22) + 70 * S);
      const h = sub ? 176 * S : 130 * S;
      ctx.save(); ctx.globalAlpha = Math.min(1, env(e, 0.4, 0.3).o * 1.0);
      ctx.beginPath(); ctx.rect(x, y - 10 * S, w * wipe + 10 * S, h + 20 * S); ctx.clip();
      panel(x, y, w, h, { accent: color });
      text((c.kicker ?? '').toUpperCase(), x + 34 * S, y + 42 * S, { w: 600, px: 22, color: GOLD, spacing: 0.22 });
      text(head, x + 32 * S, y + 108 * S, { px: 64, spacing: 0.01 });
      if (sub) text(sub, x + 34 * S, y + 150 * S, { w: 500, px: 30, color: DIM });
      ctx.restore();
    },

    // A tag over real footage: a rider pill with a pointer, at a spot chosen by the editor.
    tag(c, e) {
      const a = vis(e, 0.35, 0.25);
      if (a <= 0) return;
      const r = riders[c.rider], x = c.x * W, y = c.y * H;
      const label = name(c.rider), extra = c.extra ?? '';
      const lw = measure(label, 700, 34, 0.03), ew = extra ? measure(extra, 600, 28) + 26 * S : 0;
      const w = 74 * S + lw + ew + 26 * S, h = 62 * S;
      const pop = 0.85 + 0.15 * easeOut(clamp01(e.since / 0.35));
      ctx.save(); ctx.globalAlpha = a;
      ctx.translate(x, y); ctx.scale(pop, pop);
      const bx = c.align === 'right' ? -w : c.align === 'center' ? -w / 2 : 0, by = -h - 18 * S;
      panel(bx, by, w, h, { r: 31, fill: 'rgba(12,16,14,0.88)' });
      ctx.lineWidth = 3 * S; ctx.strokeStyle = r.color; ctx.beginPath(); ctx.roundRect(bx, by, w, h, 31 * S); ctx.stroke();
      dot(bx + 34 * S, by + h / 2, 22 * S, r.color, r.letter);
      text(label, bx + 66 * S, by + h / 2 + 12 * S, { px: 34, spacing: 0.03 });
      if (extra) text(extra, bx + 66 * S + lw + 22 * S, by + h / 2 + 11 * S, { w: 600, px: 28, color: c.extraColor ?? GOLD });
      // pointer
      const px = c.align === 'right' ? -40 * S : c.align === 'center' ? 0 : 40 * S;
      ctx.beginPath(); ctx.moveTo(px - 10 * S, -18 * S); ctx.lineTo(px + 10 * S, -18 * S); ctx.lineTo(px, -2 * S); ctx.closePath(); ctx.fillStyle = r.color; ctx.fill();
      ctx.restore();
    },

    // A data callout: a rider's number, counted up as it lands (441 W, 196 BPM), with what it means.
    stat(c, e) {
      const k = env(e, 0.35, 0.3), a = Math.min(k.i, k.o);
      if (a <= 0) return;
      const r = c.rider != null ? riders[c.rider] : null, color = c.color ?? GOLD;
      const u = easeOut(clamp01(e.since / (c.count ?? 0.7)));
      const value = typeof c.value === 'number' ? (c.decimals ? (c.value * u).toFixed(c.decimals) : String(Math.round(c.value * u))) : c.value;
      const big = c.px ?? 150, unitPx = Math.round(big * 0.34);
      const vw = measure(typeof c.value === 'number' ? (c.decimals ? c.value.toFixed(c.decimals) : String(Math.round(c.value))) : c.value, 700, big);
      const head = r ? r.name.toUpperCase() : (c.head ?? '').toUpperCase();
      const w = Math.max(vw + measure(c.unit ?? '', 700, unitPx) + 90 * S, measure(c.label ?? '', 600, 26, 0.16) + 70 * S, measure(head, 700, 34, 0.04) + 120 * S);
      const h = (big * 1.0 + 150) * S;
      const x = c.x ?? L.x, y = (c.y != null ? c.y * H : (portrait ? L.bottom - h - 300 * S : L.bottom - h - 220 * S)) + (1 - k.i) * 30 * S;
      ctx.save(); ctx.globalAlpha = a;
      panel(x, y, w, h, { accent: r?.color ?? color });
      if (r) dot(x + 50 * S, y + 50 * S, 20 * S, r.color, r.letter);
      text(head, x + (r ? 82 : 34) * S, y + 62 * S, { px: 34, spacing: 0.04 });
      const vy = y + 62 * S + big * 0.92 * S;
      num(value, x + 32 * S, vy, { px: big, color });
      text(c.unit ?? '', x + 32 * S + vw + 12 * S, vy, { px: unitPx, color });
      text((c.label ?? '').toUpperCase(), x + 34 * S, y + h - 30 * S, { w: 600, px: 26, color: DIM, spacing: 0.16 });
      ctx.restore();
    },

    // Two riders, one number, side by side at the same moment (same road, different hearts).
    duel(c, e) {
      const k = env(e, 0.4, 0.3), a = Math.min(k.i, k.o), t = e.t;
      if (a <= 0 || t == null) return;
      const key = c.metric ?? 'hr', unit = key === 'hr' ? 'BPM' : key === 'speed' ? 'KM/H' : 'W';
      const w = Math.min(portrait ? W - 2 * L.x : 760 * S, L.right - L.x), rowH = 96 * S, h = 74 * S + rowH * c.riders.length;
      const x = c.x ?? L.x, y = (c.y != null ? c.y * H : (portrait ? L.bottom - h - 300 * S : L.bottom - h - 220 * S)) + (1 - k.i) * 30 * S;
      ctx.save(); ctx.globalAlpha = a;
      panel(x, y, w, h);
      text((c.title ?? (key === 'hr' ? 'HEART RATE' : 'POWER')).toUpperCase(), x + 30 * S, y + 46 * S, { w: 600, px: 22, color: GOLD, spacing: 0.22 });
      c.riders.forEach((i, n) => {
        const r = riders[i], ry = y + 74 * S + n * rowH, u = easeOut(clamp01((e.since - 0.12 * n) / 0.7));
        const v = interpolate(r.samples, t, key);
        if (n) { ctx.fillStyle = LINE; ctx.fillRect(x + 30 * S, ry, w - 60 * S, 1.5 * S); }
        dot(x + 54 * S, ry + rowH / 2, 22 * S, r.color, r.letter);
        text(r.name.toUpperCase(), x + 90 * S, ry + rowH / 2 + 13 * S, { px: 38, spacing: 0.03 });
        const uw = measure(unit, 700, 30);
        text(unit, x + w - 30 * S, ry + rowH / 2 + 22 * S, { px: 30, color: c.colors?.[n] ?? DIM, align: 'right' });
        num(v == null ? '—' : String(Math.round(v * u)), x + w - 40 * S - uw, ry + rowH / 2 + 24 * S, { px: 74, color: c.colors?.[n] ?? INK, align: 'right' });
      });
      ctx.restore();
    },

    // A live telemetry trace: one rider's power or heart rate over a stretch of the race, drawn up to
    // the race time on screen, the number now in big type, a highlighted window (the attack's 30 s).
    trace(c, e) {
      const a = vis(e, 0.4, 0.3), t = e.t;
      if (a <= 0 || t == null) return;
      const r = riders[c.rider], key = c.metric ?? 'watts', [t0, t1] = c.window;
      const pts = [];
      for (let s = t0; s <= t1; s += 2) { const v = interpolate(r.samples, s, key); if (v != null) pts.push([s, v]); }
      if (pts.length < 2) return;
      const lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]));
      const w = c.w ?? (L.right - L.x), h = (c.h ?? 250) * S;
      const x = c.x ?? L.x, y = (c.y != null ? c.y * H : (portrait ? L.bottom - h - 40 * S : L.bottom - h)) + (1 - env(e, 0.4, 0.3).i) * 30 * S;
      const left = x + 28 * S, right = x + w - 28 * S, top = y + 92 * S, bot = y + h - 26 * S;
      const X = s => left + (s - t0) / (t1 - t0) * (right - left), Y = v => bot - (v - lo) / Math.max(1, hi - lo) * (bot - top);
      const now = Math.max(t0, Math.min(t1, t)), color = c.color ?? r.color;
      ctx.save(); ctx.globalAlpha = a;
      panel(x, y, w, h, { accent: r.color });
      dot(x + 46 * S, y + 46 * S, 18 * S, r.color, r.letter);
      text(r.name.toUpperCase(), x + 76 * S, y + 56 * S, { px: 30, spacing: 0.04 });
      text((c.label ?? (key === 'hr' ? 'HEART RATE' : 'POWER')).toUpperCase(), x + 76 * S, y + 82 * S, { w: 600, px: 19, color: DIM, spacing: 0.16 });
      const cur = interpolate(r.samples, now, key);
      const unit = key === 'hr' ? 'BPM' : key === 'speed' ? 'KM/H' : 'W';
      const uw = measure(unit, 700, 28);
      text(unit, right, y + 74 * S, { px: 28, color, align: 'right' });
      num(cur == null ? '—' : String(Math.round(cur)), right - uw - 8 * S, y + 74 * S, { px: 64, color, align: 'right' });
      // highlight window
      if (c.band) {
        const [b0, b1] = c.band;
        if (now >= b0) {
          const bx0 = X(b0), bx1 = X(Math.min(now, b1));
          ctx.fillStyle = 'rgba(255,211,77,0.16)'; ctx.fillRect(bx0, top - 8 * S, bx1 - bx0, bot - top + 8 * S);
          if (c.bandLabel && now >= b1) text(c.bandLabel.toUpperCase(), (bx0 + X(b1)) / 2, top - 14 * S, { w: 700, px: 22, color: GOLD, align: 'center', spacing: 0.08 });
        }
      }
      // the trace up to now
      const drawn = pts.filter(p => p[0] <= now);
      if (drawn.length > 1) {
        ctx.beginPath(); drawn.forEach((p, k2) => k2 ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
        ctx.lineTo(X(drawn.at(-1)[0]), bot); ctx.lineTo(X(drawn[0][0]), bot); ctx.closePath();
        const g = ctx.createLinearGradient(0, top, 0, bot); g.addColorStop(0, `${color}55`); g.addColorStop(1, `${color}00`);
        ctx.fillStyle = g; ctx.fill();
        ctx.beginPath(); drawn.forEach((p, k2) => k2 ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
        ctx.strokeStyle = color; ctx.lineWidth = 4 * S; ctx.lineJoin = 'round'; ctx.stroke();
        if (cur != null) { ctx.beginPath(); ctx.arc(X(now), Y(cur), 8 * S, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); }
      }
      ctx.restore();
    },

    // A finisher caption over real footage: the place in big gold figures, the name, the gap and the time.
    finisher(c, e) {
      const a = vis(e, 0.35, 0.3);
      if (a <= 0) return;
      const i = c.rider, r = riders[i], rank = model.byFinish.indexOf(i) + 1;
      const gap = rank === 1 ? formatClock(r.finish) : formatGap(r.finish - riders[model.winner].finish);
      const sub = c.sub ?? `${gap}  ·  ${formatClock(r.finish)}`;
      const rankW = measure(String(rank), 700, 132), suf = ORDINAL(rank).slice(String(rank).length).toUpperCase();
      const nameW = measure(name(i), 700, 62, 0.01), subW = measure(sub, 600, 32, 0.04);
      const left = 34 * S + rankW + measure(suf, 700, 34) + 30 * S;
      const w = left + Math.max(nameW, subW) + 40 * S, h = 168 * S;
      const x = c.x ?? L.x, y = c.y ?? (portrait ? L.bottom - 250 * S : L.bottom - h);
      const wipe = easeOut(clamp01(e.since / 0.45));
      ctx.save(); ctx.globalAlpha = env(e, 0.35, 0.3).o;
      ctx.beginPath(); ctx.rect(x - 10 * S, y - 10 * S, (w + 20 * S) * wipe, h + 20 * S); ctx.clip();
      panel(x, y, w, h, { accent: r.color });
      const rx = x + 30 * S;
      text(String(rank), rx, y + 132 * S, { px: 132, color: rank <= 3 ? GOLD : INK });
      text(suf, rx + rankW + 4 * S, y + 62 * S, { px: 34, color: rank <= 3 ? GOLD : INK });
      text(name(i), x + left, y + 80 * S, { px: 62, spacing: 0.01 });
      text(sub, x + left + 2 * S, y + 128 * S, { w: 600, px: 32, color: DIM, spacing: 0.04 });
      ctx.restore();
    },

    // Where and when a phone clip was filmed: the sync that makes the match cut.
    stamp(c, e) {
      const a = vis(e, 0.3, 0.25);
      if (a <= 0) return;
      const parts = c.parts; // [['REAL', gold], ['12:04:29'], ['KM 4.2']]
      const h = 48 * S;
      const total = parts.reduce((s, p) => s + measure(p[0], 700, 26, 0.12) + 34 * S, 0);
      // top right, clear of the race bug on the left
      const x = c.x ?? L.right - total - 10 * S, y = c.y ?? L.top;
      let cx = x;
      ctx.save(); ctx.globalAlpha = a;
      panel(x, y, total + 10 * S, h, { r: 12, fill: 'rgba(8,10,9,0.72)' });
      cx += 18 * S;
      parts.forEach(([s, color]) => { cx += text(s, cx, y + 33 * S, { px: 26, color: color ?? INK, spacing: 0.12 }) + 34 * S; });
      ctx.restore();
    },

    // Big centred type: the title, a word on a hit, a winning time.
    title(c, e) {
      const k = env(e, 0.6, 0.45), a = Math.min(k.i, k.o);
      if (a <= 0) return;
      const cx = W / 2, cy = (c.y ?? 0.42) * H;
      ctx.save(); ctx.globalAlpha = a;
      // darken behind for legibility
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.8);
      g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const lines = c.lines; // [{ text, px, w, color, spacing }]
      let y = cy - lines.reduce((s, l) => s + l.px * S * 1.02, 0) / 2;
      lines.forEach((l, k2) => {
        const delay = k2 * 0.12, u = easeOut(clamp01((e.since - delay) / 0.6));
        y += l.px * S;
        ctx.save();
        ctx.globalAlpha = a * u;
        const track = (l.spacing ?? 0) + (1 - u) * 0.25; // letters tighten as they land
        text(l.text, cx, y + (1 - u) * 26 * S, { w: l.w ?? 700, px: l.px, color: l.color ?? INK, align: 'center', spacing: track, shadow: 24 });
        ctx.restore();
        y += l.px * S * 0.02 + (l.gap ?? 14) * S;
      });
      if (c.rule) { // a gold rule under the title, drawn out from the centre
        const u = easeInOut(clamp01((e.since - 0.25) / 0.7)), rw = (c.rule * S) * u;
        ctx.fillStyle = GOLD; ctx.fillRect(cx - rw / 2, y + 6 * S, rw, 5 * S);
      }
      ctx.restore();
    },

    // A punch word for a big moment (ATTACK!, WINNER): scales down onto the frame with a flash of colour.
    punch(c, e) {
      const k = env(e, 0.18, 0.3), a = Math.min(k.i, k.o);
      if (a <= 0) return;
      const u = easeOut(clamp01(e.since / 0.35)), s = lerp(1.6, 1, u);
      const cx = W / 2, cy = (c.y ?? 0.5) * H;
      ctx.save(); ctx.globalAlpha = a;
      ctx.translate(cx, cy); ctx.scale(s, s);
      text(c.text.toUpperCase(), 0, 0, { px: c.px ?? 190, color: c.color ?? GOLD, align: 'center', base: 'middle', spacing: 0.02, shadow: 40 });
      if (c.sub) text(c.sub.toUpperCase(), 0, (c.px ?? 190) * 0.62 * S, { w: 600, px: 40, color: INK, align: 'center', base: 'middle', spacing: 0.2, shadow: 20 });
      ctx.restore();
    },

    // Gap to the winner along the climb: one line per rider, drawn up the road.
    gaps(c, e) {
      const a = vis(e, 0.5, 0.4);
      if (a <= 0) return;
      const w = portrait ? W - 2 * L.x : 1100 * S, h = (portrait ? 620 : 560) * S;
      const x = portrait ? L.x : (W - w) / 2, y = c.y ?? (portrait ? (H - h) / 2 + 60 * S : (H - h) / 2 + 40 * S);
      const len = model.len, win = riders[model.winner];
      const N = 120, ds = Array.from({ length: N + 1 }, (_, k) => k / N * len);
      const gapAt = (r, d) => timeAtDistance(r.samples, d) - timeAtDistance(win.samples, d);
      const lines = riders.map(r => ds.map(d => gapAt(r, d)));
      const maxG = Math.max(30, ...lines.flat()), minG = Math.min(0, ...lines.flat());
      const top = y + 110 * S, bot = y + h - 60 * S, lx = x + 30 * S, rx = x + w - 170 * S;
      const X = d => lx + d / len * (rx - lx), Y = g => top + (g - minG) / (maxG - minG) * (bot - top);
      ctx.save(); ctx.globalAlpha = a;
      panel(x, y, w, h);
      text('GAP TO THE WINNER', x + 30 * S, y + 50 * S, { w: 600, px: 24, color: GOLD, spacing: 0.22 });
      text('ALONG THE CLIMB', x + 30 * S, y + 84 * S, { w: 600, px: 22, color: DIM, spacing: 0.16 });
      ctx.setLineDash([6 * S, 8 * S]); ctx.strokeStyle = LINE; ctx.lineWidth = 1.5 * S;
      ctx.beginPath(); ctx.moveTo(lx, Y(0)); ctx.lineTo(rx, Y(0)); ctx.stroke(); ctx.setLineDash([]);
      for (let k = 1; k * 1000 < len; k++) text(String(k), X(k * 1000), bot + 34 * S, { w: 600, px: 19, color: FAINT, align: 'center' });
      text('KM', rx, bot + 34 * S, { w: 600, px: 19, color: FAINT, align: 'right' });
      const draw = easeInOut(clamp01((e.since - 0.3) / 2.2)); // lines grow up the climb
      const upto = Math.max(1, Math.round(draw * N));
      const order = model.byFinish.slice().reverse();
      for (const i of order) {
        ctx.strokeStyle = riders[i].color; ctx.lineWidth = (i === model.winner ? 6 : 4.5) * S; ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let k = 0; k <= upto; k++) { const px = X(ds[k]), py = Y(lines[i][k]); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
        ctx.stroke();
        const ex = X(ds[upto]), ey = Y(lines[i][upto]);
        dot(ex, ey, 12 * S, riders[i].color, riders[i].letter);
      }
      // labels at the right edge once drawn
      if (draw > 0.97) {
        const la = clamp01((e.since - 2.5) / 0.4);
        const placed = [];
        for (const i of model.byFinish) {
          let ly = Y(lines[i][N]);
          for (const p of placed) if (Math.abs(p - ly) < 34 * S) ly = p + 34 * S;
          placed.push(ly);
          text(`${riders[i].name.toUpperCase()}`, rx + 22 * S, ly + 9 * S, { w: 600, px: 24, color: INK, alpha: la });
          text(i === model.winner ? formatClock(riders[i].finish) : formatGap(riders[i].finish - win.finish), x + w - 22 * S, ly + 9 * S, { w: 600, px: 22, color: i === model.winner ? GOLD : DIM, alpha: la, align: 'right' });
        }
      }
      ctx.restore();
    },

    // Results: the podium rising, then the rest.
    results(c, e) {
      const a = vis(e, 0.5, 0.4);
      if (a <= 0) return;
      const w = portrait ? W - 2 * L.x : 1000 * S, x = portrait ? L.x : (W - w) / 2;
      const y = c.y ?? (portrait ? L.top + 80 * S : 70 * S);
      ctx.save(); ctx.globalAlpha = a;
      text(c.kicker ?? 'AT THE SUMMIT', x, y + 30 * S, { w: 600, px: 26, color: GOLD, spacing: 0.24 });
      text(c.head ?? 'EVERY EFFORT. ONE CLIMB.', x, y + 100 * S, { px: portrait ? 70 : 64 });
      // podium 2 · 1 · 3
      const colW = (w - 40 * S) / 3, base = y + (portrait ? 520 : 440) * S, hts = [260, 210, 180];
      [1, 0, 2].forEach((rank, col) => {
        const i = model.byFinish[rank], r = riders[i];
        const delay = [0.5, 0.2, 0.8][rank], u = easeOut(clamp01((e.since - delay) / 0.6));
        const hh = hts[rank] * S * u, px = x + col * (colW + 20 * S), top = base - hh;
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(px, top, colW, hh);
        ctx.fillStyle = r.color; ctx.fillRect(px, top, colW, 7 * S);
        if (u > 0.6) {
          const ta = clamp01((u - 0.6) / 0.4);
          text(String(rank + 1), px + 22 * S, top + (rank ? 70 : 92) * S, { px: rank ? 72 : 96, color: rank ? DIM : GOLD, alpha: ta });
          text(r.name.toUpperCase(), px + 22 * S, base - 64 * S, { px: 40, alpha: ta, spacing: 0.02 });
          text(rank ? formatGap(r.finish - riders[model.winner].finish) : formatClock(r.finish), px + 22 * S, base - 22 * S, { w: 600, px: 32, color: rank ? DIM : GOLD, alpha: ta });
        }
      });
      // the rest
      let ry = base + 40 * S;
      model.byFinish.slice(3).forEach((i, k) => {
        const r = riders[i], u = easeOut(clamp01((e.since - 1.1 - k * 0.12) / 0.45));
        const rh = 66 * S;
        ctx.save(); ctx.globalAlpha = a * u; ctx.translate((1 - u) * 50 * S, 0);
        ctx.fillStyle = LINE; ctx.fillRect(x, ry + rh - 1.5 * S, w, 1.5 * S);
        num(String(k + 4), x + 30 * S, ry + rh * 0.68, { px: 34, color: DIM, align: 'right' });
        dot(x + 72 * S, ry + rh / 2, 20 * S, r.color, r.letter);
        text(r.name.toUpperCase(), x + 108 * S, ry + rh * 0.68, { w: 600, px: 34 });
        num(formatClock(r.finish), x + w - 170 * S, ry + rh * 0.68, { w: 600, px: 32, align: 'right' });
        text(formatGap(r.finish - riders[model.winner].finish), x + w, ry + rh * 0.68, { w: 600, px: 32, color: DIM, align: 'right' });
        ctx.restore();
        ry += rh;
      });
      ctx.restore();
    },

    // The closing card: name, place, credits.
    end(c, e) {
      const a = vis(e, 0.8, 0.6);
      if (a <= 0) return;
      ctx.save(); ctx.globalAlpha = a;
      const cy = H * (portrait ? 0.42 : 0.4);
      text('WIELKI WYŚCIG', W / 2, cy - 120 * S, { w: 600, px: 34, color: GOLD, spacing: 0.3, align: 'center' });
      text('COLL DE SA BATALLA', W / 2, cy, { px: portrait ? 104 : 120, align: 'center', spacing: 0.01 });
      text(c.line ?? 'MALLORCA · 17.10.2026', W / 2, cy + 64 * S, { w: 500, px: 36, color: DIM, align: 'center', spacing: 0.12 });
      const u = easeInOut(clamp01((e.since - 0.4) / 0.8));
      ctx.fillStyle = GOLD; ctx.fillRect(W / 2 - 160 * S * u, cy + 100 * S, 320 * S * u, 5 * S);
      text(c.cta ?? 'REPLAY THE RACE IN 3D', W / 2, cy + 180 * S, { w: 600, px: 38, align: 'center', spacing: 0.16 });
      const lines = c.credits ?? [], cy0 = portrait ? L.bottom - 40 * S - lines.length * 34 * S : H - 70 * S - lines.length * 32 * S;
      lines.forEach((line, k) => text(line, W / 2, cy0 + k * (portrait ? 34 : 32) * S, { w: 500, px: portrait ? 21 : 20, color: DIM, align: 'center', alpha: 0.85 }));
      ctx.restore();
    },
  };

  return {
    S, L,
    setArea(a) { Object.assign(L, L0, a ?? {}, { area: !!a }); },
    draw(cue, envData) { const fn = G[cue.type]; if (!fn) throw new Error(`unknown overlay ${cue.type}`); fn(cue, envData); },
  };
}

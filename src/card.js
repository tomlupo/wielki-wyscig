// The end-of-race card: one 1080×1350 canvas (Instagram / WhatsApp portrait),
// shown in the results dialog and saved or shared as the same PNG.
import { interpolate, timeAtDistance, standings, formatClock, formatGap } from './race.js';
import { gradeColor } from './profile.js';

export const CARD_W = 1080, CARD_H = 1350;
const INK = '#f4f2ea', DIM = '#a9b2a7', FAINT = '#6f786e', GOLD = '#ffd34d', LINE = 'rgba(255,255,255,0.12)';
const FONT = '"Barlow Condensed", "Arial Narrow", system-ui, sans-serif';

// Time-weighted mean power over the ride; null when the rider has no power data.
export function averageWatts(samples) {
  let sum = 0, span = 0;
  for (let k = 1; k < samples.length; k++) {
    const a = samples[k - 1], b = samples[k];
    if (a.watts == null || b.watts == null) continue;
    sum += (a.watts + b.watts) / 2 * (b.t - a.t);
    span += b.t - a.t;
  }
  return span ? sum / span : null;
}

// Everything the card says, as data: results rows and the moves (passes and lead changes).
export function cardData(riders, events) {
  const duration = Math.max(...riders.map(r => r.samples.at(-1).t));
  const rows = standings(riders, duration).map(row => {
    const r = riders[row.index], watts = averageWatts(r.samples), kg = r.kg ?? r.weightKg ?? null;
    return { ...row, rider: r, watts, wkg: watts != null && kg > 0 ? watts / kg : null };
  });
  const moves = events.filter(e => e.type === 'lead' || e.type === 'pass')
    .sort((a, b) => b.score - a.score).slice(0, 3).sort((a, b) => a.t - b.t)
    .map(e => ({ ...e, km: interpolate(riders[e.rider].samples, e.t, 'd') / 1000 }));
  return { rows, moves };
}

const font = (weight, px) => `${weight} ${px}px ${FONT}`;
function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > max) text = text.slice(0, -1);
  return text + '…';
}
function spaced(ctx, text, x, y, spacing) { // letter-spaced caps, as the app's kickers
  ctx.letterSpacing = `${spacing}px`;
  ctx.fillText(text, x, y);
  ctx.letterSpacing = '0px';
}

export async function drawCard(canvas, { riders, events, route, profile, stats, title, place, clockOffset = 0 }) {
  await Promise.all(['600', '700'].map(w => document.fonts?.load(font(w, 40)).catch(() => {})));
  canvas.width = CARD_W; canvas.height = CARD_H;
  const ctx = canvas.getContext('2d'), P = 72, W = CARD_W - 2 * P;
  const { rows, moves } = cardData(riders, events);
  const len = route.at(-1)[3];

  const bg = ctx.createLinearGradient(0, 0, 0, CARD_H);
  bg.addColorStop(0, '#1d2a2a'); bg.addColorStop(0.45, '#0e1412'); bg.addColorStop(1, '#0b0f0d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.textBaseline = 'alphabetic';

  // ---- title
  ctx.fillStyle = GOLD; ctx.font = font(600, 28);
  spaced(ctx, 'WIELKI WYŚCIG · RESULTS', P, 108, 7);
  ctx.fillStyle = INK; ctx.font = font(700, 96);
  ctx.fillText(fit(ctx, title.toUpperCase(), W), P, 196);
  ctx.fillStyle = DIM; ctx.font = font(600, 32);
  ctx.fillText(`${(stats.length / 1000).toFixed(1)} km · +${Math.round(stats.top - stats.start)} m · ${stats.avgGrade.toFixed(1)}% avg · ${place}`, P, 246);

  // ---- podium: 2 · 1 · 3
  const colW = (W - 2 * 20) / 3, base = 500, heights = [210, 180, 160];
  [1, 0, 2].forEach((rank, col) => {
    const row = rows[rank];
    if (!row) return;
    const x = P + col * (colW + 20), h = heights[rank], top = base - h, c = row.rider.color;
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x, top, colW, h);
    ctx.fillStyle = c; ctx.fillRect(x, top, colW, 6);
    ctx.fillStyle = rank === 0 ? GOLD : DIM; ctx.font = font(700, rank === 0 ? 76 : 60);
    ctx.fillText(String(rank + 1), x + 20, top + (rank === 0 ? 80 : 62));
    ctx.fillStyle = INK; ctx.font = font(700, 38);
    ctx.fillText(fit(ctx, row.rider.name.toUpperCase(), colW - 40), x + 20, base - 48);
    ctx.fillStyle = rank === 0 ? GOLD : DIM; ctx.font = font(600, 30);
    ctx.fillText(rank === 0 ? formatClock(row.finish + clockOffset + 1e-6) : formatGap(row.gap), x + 20, base - 14);
  });

  // ---- full results
  let y = 552;
  const powerKnown = rows.some(r => r.watts != null), wkgKnown = rows.some(r => r.wkg != null);
  const cols = { rank: P, name: P + 92, time: P + W - (powerKnown ? 360 : 150), gap: P + W - (powerKnown ? 200 : 0), power: P + W };
  ctx.fillStyle = FAINT; ctx.font = font(600, 22);
  spaced(ctx, 'RIDER', cols.name, y, 4);
  ctx.textAlign = 'right';
  spaced(ctx, 'TIME', cols.time, y, 4);
  spaced(ctx, 'GAP', cols.gap, y, 4);
  if (powerKnown) spaced(ctx, wkgKnown ? 'AVG W · W/KG' : 'AVG W', cols.power, y, 4);
  ctx.textAlign = 'left';
  const rowH = Math.min(48, 260 / rows.length), fs = Math.round(rowH * 0.62);
  y += 14;
  for (const row of rows) {
    const mid = y + rowH / 2, base = mid + fs * 0.36;
    ctx.fillStyle = LINE; ctx.fillRect(P, y + rowH - 1, W, 1);
    ctx.fillStyle = row.rank === 1 ? GOLD : DIM; ctx.font = font(700, fs);
    ctx.fillText(String(row.rank), cols.rank, base);
    ctx.fillStyle = row.rider.color;
    ctx.beginPath(); ctx.arc(cols.rank + 56, mid, rowH * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111'; ctx.font = font(700, Math.round(fs * 0.8)); ctx.textAlign = 'center';
    ctx.fillText(row.rider.letter, cols.rank + 56, mid + fs * 0.29);
    ctx.textAlign = 'left'; ctx.fillStyle = INK; ctx.font = font(600, fs);
    ctx.fillText(fit(ctx, row.rider.name.toUpperCase(), cols.time - 150 - cols.name), cols.name, base);
    ctx.textAlign = 'right';
    ctx.fillText(formatClock(row.finish + clockOffset + 1e-6), cols.time, base);
    ctx.fillStyle = DIM;
    ctx.fillText(row.rank === 1 ? '—' : formatGap(row.gap), cols.gap, base);
    if (powerKnown) {
      ctx.fillStyle = INK;
      ctx.fillText(row.watts == null ? '—' : `${Math.round(row.watts)} W${row.wkg != null ? ` · ${row.wkg.toFixed(1)}` : ''}`, cols.power, base);
    }
    ctx.textAlign = 'left';
    y += rowH;
  }

  // ---- the moves
  y += 46;
  if (moves.length) {
    ctx.fillStyle = GOLD; ctx.font = font(600, 24);
    spaced(ctx, 'THE MOVES', P, y, 6);
    y += 12;
    for (const m of moves) {
      y += 38;
      ctx.fillStyle = riders[m.rider].color; ctx.fillRect(P, y - 24, 6, 28);
      ctx.fillStyle = DIM; ctx.font = font(600, 28);
      ctx.fillText(`km ${m.km.toFixed(1)}`, P + 22, y);
      ctx.fillStyle = INK; ctx.font = font(600, 30);
      ctx.fillText(fit(ctx, m.text, W - 130), P + 130, y);
    }
  }

  // ---- elevation profile, and each rider's gap to the winner along it
  const box = { x: P, y: y + 70, w: W, h: 0 };
  box.h = CARD_H - 92 - box.y;
  const [lo, hi] = [Math.min(...profile.map(p => p.ele)), Math.max(...profile.map(p => p.ele))];
  const X = d => box.x + d / len * box.w, E = e => box.y + box.h - (e - lo) / (hi - lo) * box.h * 0.75;
  const grad = ctx.createLinearGradient(box.x, 0, box.x + box.w, 0);
  for (let i = 0; i < profile.length; i += 8) grad.addColorStop(profile[i].d / len, `rgba(${gradeColor(profile[i].grade)},0.35)`);
  ctx.beginPath(); ctx.moveTo(X(0), box.y + box.h);
  for (const p of profile) ctx.lineTo(X(p.d), E(p.ele));
  ctx.lineTo(X(len), box.y + box.h); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = 'rgba(244,242,234,0.5)'; ctx.lineWidth = 2;
  ctx.beginPath(); profile.forEach((p, k) => k ? ctx.lineTo(X(p.d), E(p.ele)) : ctx.moveTo(X(p.d), E(p.ele))); ctx.stroke();

  const winner = riders[rows[0].index], step = len / 120;
  const gapAt = (r, d) => timeAtDistance(r.samples, d) - timeAtDistance(winner.samples, d);
  const ds = Array.from({ length: 121 }, (_, k) => Math.min(len, k * step));
  const lines = rows.map(row => ds.map(d => gapAt(row.rider, d))), all = lines.flat();
  const maxGap = Math.max(10, ...all), minGap = Math.min(0, ...all);
  const G = g => box.y + 8 + (g - minGap) / (maxGap - minGap) * (box.h - 16);
  ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.setLineDash([6, 8]);
  ctx.beginPath(); ctx.moveTo(box.x, G(0)); ctx.lineTo(box.x + box.w, G(0)); ctx.stroke(); ctx.setLineDash([]);
  for (let k = rows.length - 1; k >= 0; k--) { // the winner drawn last, on top
    ctx.strokeStyle = rows[k].rider.color; ctx.lineWidth = k ? 4 : 5; ctx.lineJoin = 'round';
    ctx.beginPath();
    ds.forEach((d, j) => j ? ctx.lineTo(X(d), G(lines[k][j])) : ctx.moveTo(X(d), G(lines[k][j])));
    ctx.stroke();
  }
  ctx.fillStyle = DIM; ctx.font = font(600, 22);
  for (let k = 1; k * 1000 < len; k++) ctx.fillText(`${k}`, X(k * 1000) - 5, box.y + box.h + 28);
  ctx.fillText('km', X(len) - 24, box.y + box.h + 28);
  ctx.fillStyle = FAINT;
  spaced(ctx, 'GAP TO THE WINNER ALONG THE CLIMB', P, box.y - 16, 4);
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(stats.start)} → ${Math.round(stats.top)} m`, P + W, box.y - 16);
  ctx.textAlign = 'left';

  // ---- footer
  ctx.fillStyle = FAINT; ctx.font = font(600, 24);
  spaced(ctx, `REPLAY IT IN 3D · ${location.host.toUpperCase()}`, P, CARD_H - 30, 4);
  return canvas;
}

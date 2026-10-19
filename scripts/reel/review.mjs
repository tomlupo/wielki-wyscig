// Review sheet: render the start, middle and end frame of every shot (or of some) of a plan,
// labelled, in one image, to check framing without rendering the whole reel.
//
//   node scripts/reel/review.mjs [--plan out/reel/plan-9x16-preview.json] [--kind 3d] [--ids title,attack] [--out out/reel/review.jpg]
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { openRenderer } from './browser.mjs';
import { WORK } from './paths.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const plan = JSON.parse(readFileSync(opt('plan', `${WORK}/plan-9x16-preview.json`), 'utf8'));
const kind = opt('kind', null), ids = opt('ids', null)?.split(',');
const shots = plan.shots.filter(s => (!kind || s.kind === kind) && (!ids || ids.includes(s.id)));
const tmp = `${WORK}/review-tmp`;
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const r = await openRenderer({ w: plan.w, h: plan.h });
await r.page.evaluate(p => window.R.load(p), plan);
const tiles = [];
for (const s of shots) {
  const inset = Math.min(8, Math.floor((s.end - s.start) / 4)); // clear of the transitions at the cuts
  for (const [label, f] of [['a', s.start + inset], ['b', Math.round((s.start + s.end) / 2)], ['c', s.end - 1 - inset]]) {
    // warm up the shot from its first frame so trails and level of detail match a real render
    for (let w = Math.max(s.from, f - 2); w < f; w++) await r.page.evaluate(w => window.R.frame(w), w);
    const url = await r.page.evaluate(f => window.R.frame(f), f);
    const file = `${tmp}/${String(tiles.length).padStart(3, '0')}.jpg`;
    writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    tiles.push({ file, text: `${s.id} ${label} f${f}` });
  }
}
await r.close();
const out = opt('out', `${WORK}/review.jpg`);
const cols = 9, tw = plan.w > plan.h ? 320 : 180;
const inputs = tiles.flatMap(t => ['-i', t.file]);
const filters = tiles.map((t, k) => `[${k}]scale=${tw}:-2,drawtext=text='${t.text}':x=4:y=4:fontsize=13:fontcolor=white:box=1:boxcolor=black@0.6:font=Arial[t${k}]`);
const rows = Math.ceil(tiles.length / cols);
const pads = [];
for (let k = tiles.length; k < rows * cols; k++) { filters.push(`color=c=black:s=${tw}x${Math.round(tw * plan.h / plan.w)}:d=1[t${k}]`); pads.push(k); }
filters.push(`${Array.from({ length: rows * cols }, (_, k) => `[t${k}]`).join('')}xstack=inputs=${rows * cols}:layout=${Array.from({ length: rows * cols }, (_, k) => `${(k % cols) ? Array.from({ length: k % cols }, () => 'w0').join('+') : '0'}_${Math.floor(k / cols) ? Array.from({ length: Math.floor(k / cols) }, () => 'h0').join('+') : '0'}`).join('|')}[out]`);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-frames:v', '1', out]);
console.log(`${out}: ${tiles.length} frames from ${shots.length} shots`);

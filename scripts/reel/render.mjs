// Render every frame of a plan in the headless browser and encode the picture.
// Frames go to out/reel/frames/<plan>/NNNNNN.jpg (a re-run renders only what is missing, or a range).
import { mkdirSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { openRenderer } from './browser.mjs';
import { WORK } from './paths.mjs';

export async function renderPlan(plan, { name, from = 0, to = plan.frames, force = false, log = console.log, quality = 0.94 } = {}) {
  const dir = `${WORK}/frames/${name}`;
  mkdirSync(dir, { recursive: true });
  if (force) for (const f of readdirSync(dir)) unlinkSync(`${dir}/${f}`);
  const todo = [];
  for (let f = from; f < to; f++) if (!existsSync(`${dir}/${String(f).padStart(6, '0')}.jpg`)) todo.push(f);
  if (!todo.length) { log(`  ${name}: all ${plan.frames} frames present`); return dir; }
  const r = await openRenderer({ w: plan.w, h: plan.h, log });
  try {
    await r.page.evaluate(p => window.R.load(p), plan);
    const started = Date.now();
    let k = 0;
    // Render in order from the first missing frame: shots that carry state (trails, flyto starts) stay right.
    for (const f of todo) {
      const url = await r.page.evaluate((f, q) => window.R.frame(f, { quality: q }), f, quality);
      writeFileSync(`${dir}/${String(f).padStart(6, '0')}.jpg`, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
      if (++k % 60 === 0 || k === todo.length) {
        const per = (Date.now() - started) / k;
        log(`  ${name}: ${k}/${todo.length} frames, ${per.toFixed(0)} ms/frame, ${((todo.length - k) * per / 60000).toFixed(1)} min left`);
      }
    }
  } finally { await r.close(); }
  return dir;
}

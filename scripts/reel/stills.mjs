// Stills from a rendered reel: one frame from each chosen shot, copied out of out/reel/frames/<plan>.
//
//   node scripts/reel/stills.mjs --plan 9x16 [--shots title:0.55,attack:0.3,col-3:0.8]
import { readFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { OUT, WORK } from './paths.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const name = opt('plan', '9x16');
const plan = JSON.parse(readFileSync(`${WORK}/plan-${name}.json`, 'utf8'));
const picks = opt('shots', 'title:0.6,first-lead:0.5,attack:0.35,chase:0.6,gorge:0.5,col-3:0.85,col-last:0.9,results:0.85,gaps:0.9')
  .split(',').map(p => { const [id, u] = p.split(':'); return { id, u: Number(u ?? 0.5) }; });
mkdirSync(`${OUT}/stills`, { recursive: true });
for (const { id, u } of picks) {
  const s = plan.shots.find(x => x.id === id);
  if (!s) { console.log(`no shot ${id}`); continue; }
  const f = Math.round(s.start + (s.end - 1 - s.start) * u), src = `${WORK}/frames/${name}/${String(f).padStart(6, '0')}.jpg`;
  if (!existsSync(src)) { console.log(`frame ${f} of ${id} not rendered`); continue; }
  const dest = `${OUT}/stills/${name}-${id}.jpg`;
  copyFileSync(src, dest);
  console.log(dest);
}

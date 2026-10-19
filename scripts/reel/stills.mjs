// Stills from a rendered reel: one frame from each chosen shot, copied out of out/reel/frames/<plan>.
//
//   node scripts/reel/stills.mjs --plan 9x16 [--shots title:0.55,attack:0.3,wall:0.45]
import { readFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { OUT, WORK } from './paths.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const name = opt('plan', '9x16');
const plan = JSON.parse(readFileSync(`${WORK}/plan-${name}.json`, 'utf8'));
const picks = opt('shots', 'title:0.6,roadside:0.4,wall:0.45,attack:0.35,pass-profile:0.6,pines:0.5,finish:0.8,col-5:0.75,col-last:0.9,results:0.85')
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

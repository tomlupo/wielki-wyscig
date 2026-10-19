// Render 3D stills from camera specs, for framing shots before they go in the storyboard.
//
//   node scripts/reel/still.mjs --size 1080x1920 --out out/reel/stills \
//     'name=side-attack t=1225 cam={"type":"side","rider":5}' ...
import { mkdirSync, writeFileSync } from 'node:fs';
import { openRenderer } from './browser.mjs';
import { WORK } from './paths.mjs';

const args = process.argv.slice(2);
let size = '1080x1920', outDir = `${WORK}/stills`;
const shots = [];
for (let k = 0; k < args.length; k++) {
  if (args[k] === '--size') size = args[++k];
  else if (args[k] === '--out') outDir = args[++k];
  else {
    const spec = Object.fromEntries(args[k].match(/(\w+)=(\{.*\}|\S+)/g).map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
    shots.push({ name: spec.name ?? `still-${shots.length}`, t: Number(spec.t ?? 0), sec: Number(spec.sec ?? 0), cam: JSON.parse(spec.cam), focus: spec.focus != null ? Number(spec.focus) : JSON.parse(spec.cam).rider });
  }
}
const [w, h] = size.split('x').map(Number);
mkdirSync(outDir, { recursive: true });
const r = await openRenderer({ w, h });
for (const s of shots) {
  const frames = Math.max(1, Math.round(s.sec * 30) + 1);
  const shot = { id: s.name, kind: '3d', from: 0, to: frames, t: Array(frames).fill(s.t), cam: s.cam, focus: s.focus, labels: 'focus' };
  const started = Date.now();
  const url = await r.page.evaluate((shot, f) => window.R.still(shot, f), shot, frames - 1);
  writeFileSync(`${outDir}/${s.name}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`${s.name}.jpg  (${Date.now() - started} ms)`);
}
await r.close();

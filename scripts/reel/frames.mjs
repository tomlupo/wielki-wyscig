// Extract the phone-clip frames a plan uses, as JPEGs the renderer page loads:
// out/reel/clips/<clip>/<full|preview>/<source frame>.jpg. HDR (HLG) footage is tone-mapped
// to SDR BT.709 here, once, so the reel's colour does not depend on the browser.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { VIDEOS, WORK } from './paths.mjs';

// HLG/PQ → linear → BT.709 primaries → Hable tone curve → BT.709, then a touch of contrast and colour.
const TONEMAP = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';
const GRADE = 'eq=contrast=1.04:saturation=1.08';

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(-800)}`)));
  });
}

// Merge overlapping [first, last] frame ranges.
function merge(ranges) {
  const sorted = ranges.map(r => [...r]).sort((a, b) => a[0] - b[0]), out = [];
  for (const r of sorted) { const last = out.at(-1); if (last && r[0] <= last[1] + 2) last[1] = Math.max(last[1], r[1]); else out.push(r); }
  return out;
}

export async function extractFrames(plan, { log = console.log, jobs = 3 } = {}) {
  const variant = plan.preview ? 'preview' : 'full';
  const [w, h] = plan.preview ? [540, 960] : [1080, 1920];
  const tasks = [];
  for (const clip of plan.clips) {
    const dir = `${WORK}/clips/${clip.dir}/${variant}`;
    mkdirSync(dir, { recursive: true });
    for (const [first, last] of merge(clip.ranges)) {
      const missing = [];
      for (let n = first; n <= last; n++) if (!existsSync(`${dir}/${String(n).padStart(6, '0')}.jpg`)) missing.push(n);
      if (!missing.length) continue;
      const a = missing[0], b = missing.at(-1);
      const vf = [clip.hdr ? TONEMAP : 'format=yuv420p', GRADE, `fps=${clip.fps}`, `scale=${w}:${h}:flags=lanczos`].join(',');
      tasks.push({ label: `${clip.file} ${a}–${b}`, args: ['-hide_banner', '-loglevel', 'error', '-y', '-ss', (a / clip.fps).toFixed(5), '-i', `${VIDEOS}/${clip.file}`, '-frames:v', String(b - a + 1), '-vf', vf, '-q:v', '2', '-start_number', String(a), `${dir}/%06d.jpg`] });
    }
  }
  let done = 0;
  const worker = async () => { for (let t; (t = tasks.shift());) { const started = Date.now(); await run(t.args); log(`  frames ${t.label} (${((Date.now() - started) / 1000).toFixed(1)} s) [${++done}]`); } };
  await Promise.all(Array.from({ length: jobs }, worker));
  return done;
}

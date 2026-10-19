// The whole highlight reel, one command:
//
//   npm run reel                     the phone reel (9:16), full quality → out/reel-9x16.mp4
//   npm run reel -- --preview        half resolution, fast (a rough cut)
//   npm run reel -- --format 16x9    the landscape cut instead (--format both: the two)
//   npm run reel -- --from 600 --to 900 --force   re-render a frame range
//   npm run reel -- --music <file> [--rebeat]     cut to another track in data/music (--rebeat: map its beats again)
//
// Steps (each cached under out/reel): sync the clips to the race clock → beat-map the music →
// plan the edit → extract the clip frames → render every frame in headless Chrome → mix the
// audio → encode H.264/AAC.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { makePlan, loadInputs } from './plan.mjs';
import { extractFrames } from './frames.mjs';
import { renderPlan } from './render.mjs';
import { buildAudio } from './audio.mjs';
import { ROOT, OUT, WORK, MUSIC } from './paths.mjs';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
const flag = k => args.includes(`--${k}`);
const preview = flag('preview');
const format = opt('format') ?? '9x16';
const formats = format === 'both' ? ['9x16', '16x9'] : [format];
const log = (...m) => console.log(...m);
const step = (title) => log(`\n▸ ${title}`);

function sh(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', shell: false });
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} failed`);
}
function encode(framesDir, audio, out, { fps, preview }) {
  return new Promise((resolve, reject) => {
    const a = ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps), '-i', `${framesDir}/%06d.jpg`, '-i', audio,
      '-vf', 'scale=in_range=full:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p',
      // a high-bitrate master (~20 Mbit/s, capped at 24): the platforms re-encode it, so give them a clean source
      '-c:v', 'libx264', '-preset', preview ? 'veryfast' : 'slow', '-crf', preview ? '22' : '16', '-profile:v', 'high', '-tune', 'grain',
      ...(preview ? [] : ['-maxrate', '24M', '-bufsize', '48M']),
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709',
      '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out];
    const p = spawn('ffmpeg', a, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', d => { err += d; });
    p.on('close', c => c === 0 ? resolve(out) : reject(new Error(err.slice(-800))));
  });
}

mkdirSync(WORK, { recursive: true });
const t0 = Date.now();

step('The riders\' FIT rides on the wall clock');
const rides = existsSync(`${ROOT}/rides`) ? readdirSync(`${ROOT}/rides`).filter(f => f.endsWith('.fit')) : [];
if (rides.length) sh('uv', ['run', '--quiet', 'scripts/reel/tracks.py']);
else log('  no rides/*.fit: the clock comes from the clips and the col sightings alone');

step('Sync the clips to the race clock');
sh('uv', ['run', '--quiet', 'scripts/reel/sync.py']);

step('Music');
// The track: --music <file in data/music>, else the newest one there (drop a new song in and it takes over).
const tracks = existsSync(MUSIC) ? readdirSync(MUSIC).filter(f => /\.(mp3|wav|flac|m4a|ogg|aac)$/i.test(f))
  .sort((a, b) => statSync(`${MUSIC}/${b}`).mtimeMs - statSync(`${MUSIC}/${a}`).mtimeMs) : [];
if (opt('music')) tracks.unshift(opt('music'));
if (tracks.length) {
  const beats = `${WORK}/beats.json`;
  // beat-map again when the map is missing, is for another track, or is older than the track (or on --rebeat)
  const mapped = existsSync(beats) ? JSON.parse(readFileSync(beats, 'utf8')) : null;
  if (!mapped || mapped.file !== basename(tracks[0]) || statSync(beats).mtimeMs < statSync(`${MUSIC}/${tracks[0]}`).mtimeMs || flag('rebeat')) sh('uv', ['run', '--quiet', 'scripts/reel/beats.py', `${MUSIC}/${tracks[0]}`, '--out', beats]);
  else log(`  beats for ${tracks[0]} are up to date`);
} else log('  no track in data/music: cutting to a 120 BPM grid, no music in the mix');

const inputs = loadInputs();
for (const format of formats) {
  const name = `${format}${preview ? '-preview' : ''}`;
  step(`Plan ${name}`);
  const plan = makePlan({ format, preview, inputs });
  writeFileSync(`${WORK}/plan-${name}.json`, JSON.stringify(plan));
  log(`  ${plan.frames} frames, ${(plan.frames / plan.fps).toFixed(1)} s, ${plan.shots.length} shots, ${plan.cues.length} graphics`);

  step(`Clip frames ${name}`);
  const n = await extractFrames(plan, { log });
  if (!n) log('  all clip frames present');

  step(`Render ${name}`);
  const dir = await renderPlan(plan, { name, from: Number(opt('from') ?? 0), to: Number(opt('to') ?? plan.frames), force: flag('force'), log });

  step(`Audio + encode ${name}`);
  const wav = await buildAudio(plan, { out: `${WORK}/audio-${name}.wav`, log });
  const mp4 = await encode(dir, wav, `${OUT}/reel-${name}.mp4`, { fps: plan.fps, preview });
  log(`  → ${mp4.replace(ROOT + '/', '')}`);
}
log(`\nDone in ${((Date.now() - t0) / 60000).toFixed(1)} min.`);

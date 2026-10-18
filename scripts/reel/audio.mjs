// The soundtrack: the music (from the beat-mapped track), the phone clips' own sound laid in
// where the plan keeps it (the music ducks under it), and a little sound design synthesised
// here (whooshes on the fast cuts, a sub impact on the big hits, risers into the title and the
// attack), faded out at the end and loudness-normalised for phones (-14 LUFS).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { MUSIC, VIDEOS, WORK } from './paths.mjs';

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(-1200)}`)));
  });
}
// atempo takes 0.5–2 per stage
function tempoChain(speed) {
  const parts = [];
  let s = speed;
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  parts.push(`atempo=${s.toFixed(4)}`);
  return parts.join(',');
}

// Sound effects, synthesised once (deterministic: fixed noise seeds).
const SFX = {
  // a pitch-dropping sub boom with a short crack on top
  impact: { d: 1.6, src: "aevalsrc='0.95*sin(2*PI*(42+70*exp(-16*t))*t)*exp(-3.8*t)+0.22*sin(2*PI*130*t)*exp(-12*t)':s=48000:d=1.6", post: 'alimiter=limit=0.9' },
  // pink noise swelling and dying away, band-limited like air past a lens
  whoosh: { d: 0.8, src: 'anoisesrc=c=pink:r=48000:a=0.9:d=0.8:s=7', post: "highpass=f=300,lowpass=f=5200,volume='pow(sin(PI*t/0.8),2.5)':eval=frame" },
  // a two-second build: rising noise and a rising tone, cut dead at the hit
  riser: { d: 2.0, src: "aevalsrc='0.25*sin(2*PI*(180*t+260*t*t))*pow(t/2,2)':s=48000:d=2.0", noise: 'anoisesrc=c=white:r=48000:a=0.5:d=2.0:s=11', post: "highpass=f=700,volume='pow(t/2,3)':eval=frame" },
};
async function sfxFile(name) {
  const dir = `${WORK}/sfx`, file = `${dir}/${name}.wav`;
  if (existsSync(file)) return file;
  mkdirSync(dir, { recursive: true });
  const s = SFX[name];
  if (s.noise) await run(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', s.src, '-f', 'lavfi', '-i', s.noise, '-filter_complex', `[1:a]${s.post}[n];[0:a][n]amix=inputs=2:normalize=0,aformat=channel_layouts=stereo`, file]);
  else await run(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', s.src, '-af', `${s.post},aformat=channel_layouts=stereo`, file]);
  return file;
}

// Where the sound design goes, from the plan: whooshes on whips and zooms, an impact on every punch
// word and flash, a riser into the title and the attack.
function sfxCues(plan) {
  const cues = [];
  for (const s of plan.shots) {
    const cut = s.start / plan.fps;
    if (s.enter === 'whip' || s.enter === 'zoom') cues.push({ name: 'whoosh', at: cut - 0.4, gain: 0.5 });
    if (s.enter === 'flash') cues.push({ name: 'impact', at: cut - 0.02, gain: 0.45 });
    if (s.id === 'title' || s.id === 'attack') cues.push({ name: 'riser', at: cut - 2.0, gain: 0.35 });
  }
  for (const c of plan.cues) if (c.type === 'punch') cues.push({ name: 'impact', at: c.from / plan.fps - 0.02, gain: 0.8 });
  // one sound per moment: a punch on a flash cut keeps the bigger impact
  return cues.filter((c, k) => c.at >= 0 && !cues.some((o, j) => j !== k && o.name === c.name && Math.abs(o.at - c.at) < 0.15 && (o.gain > c.gain || (o.gain === c.gain && j < k))));
}

export async function buildAudio(plan, { out, log = console.log } = {}) {
  const dur = plan.frames / plan.fps;
  const inputs = [], filters = [], clipLabels = [], fxLabels = [];
  let nIn = 0; // ffmpeg input count (inputs holds their arguments)
  // phone sound, segment by segment
  for (const s of plan.shots.filter(s => s.kind === 'clip' && s.audio > 0)) {
    const a = s.src[0], b = s.src.at(-1), wall = (s.to - s.from) / plan.fps;
    const speed = Math.max(0.25, (b - a) / wall);
    const k = nIn++;
    inputs.push('-ss', a.toFixed(3), '-t', (b - a + 0.1).toFixed(3), '-i', `${VIDEOS}/${s.clip}`);
    const fade = Math.min(0.15, wall / 4);
    filters.push(`[${k}:a]aformat=channel_layouts=stereo:sample_rates=48000,${Math.abs(speed - 1) > 0.02 ? tempoChain(speed) + ',' : ''}highpass=f=120,atrim=0:${wall.toFixed(3)},afade=t=in:d=${fade},afade=t=out:st=${(wall - fade).toFixed(3)}:d=${fade},volume=${s.audio},adelay=${Math.round(s.from / plan.fps * 1000)}:all=1[c${k}]`);
    clipLabels.push(`[c${k}]`);
  }
  // sound design
  const fx = sfxCues(plan);
  for (const c of fx) {
    const k = nIn++;
    inputs.push('-i', await sfxFile(c.name));
    filters.push(`[${k}:a]volume=${c.gain},adelay=${Math.round(c.at * 1000)}:all=1[f${k}]`);
    fxLabels.push(`[f${k}]`);
  }
  const pad = `apad=whole_dur=${dur.toFixed(3)}`;
  if (clipLabels.length) filters.push(`${clipLabels.join('')}amix=inputs=${clipLabels.length}:normalize=0,${pad}[clips]`);
  if (fxLabels.length) filters.push(`${fxLabels.join('')}amix=inputs=${fxLabels.length}:normalize=0,${pad}[fx]`);
  const beds = [];
  if (plan.music) {
    const k = nIn++;
    inputs.push('-ss', plan.music.start.toFixed(3), '-i', `${MUSIC}/${plan.music.file}`);
    filters.push(`[${k}:a]aformat=channel_layouts=stereo:sample_rates=48000,atrim=0:${dur.toFixed(3)},afade=t=in:d=0.05,afade=t=out:st=${Math.max(0, dur - 3).toFixed(3)}:d=3,${pad}[music]`);
    if (clipLabels.length) {
      filters.push(`[clips]asplit=2[clipsA][clipsKey]`);
      filters.push(`[music][clipsKey]sidechaincompress=threshold=0.02:ratio=8:attack=30:release=400:makeup=1[ducked]`);
      beds.push('[ducked]', '[clipsA]');
    } else beds.push('[music]');
  } else if (clipLabels.length) beds.push('[clips]');
  if (fxLabels.length) beds.push('[fx]');
  if (!beds.length) { const k = nIn++; inputs.push('-f', 'lavfi', '-t', dur.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo'); beds.push(`[${k}:a]`); }
  filters.push(`${beds.join('')}amix=inputs=${beds.length}:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,atrim=0:${dur.toFixed(3)}[out]`);
  await run(['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-ar', '48000', '-c:a', 'pcm_s16le', out]);
  log(`  audio: ${plan.music ? 'music + ' : 'no music yet, '}${clipLabels.length} clip sounds, ${fx.length} effects → ${out.replace(WORK, 'out/reel')}`);
  return out;
}

// The soundtrack: the music (from the beat-mapped track) with the phone clips' own sound laid in
// where the plan keeps it, the music ducking under them, faded out at the end, loudness-normalised.
import { spawn } from 'node:child_process';
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

export async function buildAudio(plan, { out, log = console.log } = {}) {
  const dur = plan.frames / plan.fps;
  const inputs = [], filters = [], clipLabels = [];
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
  let clipsOut = null;
  if (clipLabels.length) {
    filters.push(`${clipLabels.join('')}amix=inputs=${clipLabels.length}:normalize=0,apad=whole_dur=${dur.toFixed(3)}[clips]`);
    clipsOut = '[clips]';
  }
  if (plan.music) {
    const k = nIn++;
    inputs.push('-ss', plan.music.start.toFixed(3), '-i', `${MUSIC}/${plan.music.file}`);
    filters.push(`[${k}:a]aformat=channel_layouts=stereo:sample_rates=48000,atrim=0:${dur.toFixed(3)},afade=t=in:d=0.05,afade=t=out:st=${Math.max(0, dur - 3).toFixed(3)}:d=3,apad=whole_dur=${dur.toFixed(3)}[music]`);
    if (clipsOut) {
      filters.push(`[clips]asplit=2[clipsA][clipsKey]`);
      filters.push(`[music][clipsKey]sidechaincompress=threshold=0.02:ratio=8:attack=30:release=400:makeup=1[ducked]`);
      filters.push(`[ducked][clipsA]amix=inputs=2:normalize=0[mix]`);
    } else filters.push('[music]anull[mix]');
  } else if (clipsOut) filters.push('[clips]anull[mix]');
  else { inputs.push('-f', 'lavfi', '-t', dur.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo'); filters.push(`[${nIn++}:a]anull[mix]`); }
  filters.push(`[mix]loudnorm=I=-14:TP=-1.5:LRA=11,atrim=0:${dur.toFixed(3)}[out]`);
  await run(['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-ar', '48000', '-c:a', 'pcm_s16le', out]);
  log(`  audio: ${clipLabels.length} clip sounds${plan.music ? ' + music' : ', no music yet'} → ${out.replace(WORK, 'out/reel')}`);
  return out;
}

// Where the reel pipeline reads and writes. Footage and renders are git-ignored.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..').replace(/\\/g, '/');
export const OUT = `${ROOT}/out`;
export const WORK = `${OUT}/reel`; // intermediate: sync, beats, plans, extracted clip frames
export const VIDEOS = process.env.REEL_VIDEOS ?? `${ROOT}/data/videos`;
export const MUSIC = process.env.REEL_MUSIC_DIR ?? `${ROOT}/data/music`;

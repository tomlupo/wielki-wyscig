# wielki-wyscig
Wielki Wyścig

## Highlight reel

`npm run reel` cuts a 60–90 s highlight reel of the climb: the riders' phone clips and the 3D replay, matched to the second, with live race graphics, cut to the music. It writes `out/reel-9x16.mp4` (1080×1920) and `out/reel-16x9.mp4` (1920×1080), H.264 + AAC. `npm run reel -- --preview` makes a half-resolution rough cut in about two minutes.

Needs ffmpeg/ffprobe and [uv](https://docs.astral.sh/uv/) on the PATH, and Chrome or Edge (or `CHROME_PATH`). Footage goes in `data/videos/`, the track in `data/music/` (both git-ignored, with `out/`). A track can carry its credit line in a sidecar, `data/music/<track>.json` → `{ "credit": "…" }`, shown on the end card.

How it works (`scripts/reel/`):

1. **`tracks.py`** + **`sync.py`**: put every clip on the race clock. With the riders' FIT files in `rides/<rider id>.fit`, `tracks.py` gives each rider's wall-clock climb start (the cut `scripts/fit_to_race.py` makes) and a 1 Hz track. `sync.py` projects each clip's GPS fix onto the road with the same map-matching, checked against the fix's altitude, then lists who passed each camera and when. Without FIT files it votes for one start time from the clips and refines it with the riders identified at the col. `clips.json` is the editor's log of what each clip shows: a rider is named on screen only where their track and the picture agree.
2. **`beats.py`**: tempo, beats, bars and the jumps in energy of the track (librosa).
3. **`storyboard.mjs`**: the edit, in acts: cold open, title, the start, the climb, the attack, the col, the results. It is mostly phone footage with the riders' data on it (power, heart rate, gaps, places), and the 3D replay appears where no phone was (the title, the attack, the win). In 16:9 a clip with data sits in a panel beside its graphics. Race moments come from `deriveEvents`; nothing is a hard-coded race time. **`plan.mjs`** snaps every cut to a beat (act changes to bars, big moments to hits) and resolves it into a frame-exact `out/reel/plan-*.json`. A caption that names a place is kept only if that place holds in the race order for its whole time on screen.
4. **`frames.mjs`**: extracts the clip frames the plan uses, tone-mapped from the iPhones' HLG HDR to SDR.
5. **`render.mjs`** + `reel.html` / `src/reel/`: headless Chrome renders every frame on the GPU. The 3D world runs on a virtual clock that only moves one frame at a time, so a render is deterministic. Cameras are scripted (`src/reel/camera.js`), and the graphics are drawn in the app's look (`src/reel/overlay.js`). `src/world.js` only gains a hook to drive the camera and hold the quality.
6. **`audio.mjs`**: music, with the phone sound laid in where the plan keeps it (the music ducks under it), loudness-normalised; then ffmpeg encodes.

Re-render a range with `--from 600 --to 900 --force`, or one format with `--format 9x16`. `node scripts/reel/review.mjs` renders the first, middle and last frame of each shot into one sheet. `node scripts/reel/still.mjs` renders single 3D frames from a camera spec.

On Windows the renderer uses ANGLE's Vulkan backend: on Direct3D 11 the app's bloom pass comes out black on the Intel iGPU this was built on (`REEL_ANGLE=d3d11` to try it).

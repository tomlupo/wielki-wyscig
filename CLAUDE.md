# Wielki Wyścig: working rules

A 3D replay of a group race up one climb (now Coll de sa Batalla, Mallorca): real terrain and
imagery, the riders' recorded FIT data, their phone clips, and highlight reels made from all of it.
Vite + three.js 0.160 + d3, plain ES modules; Python build scripts run with `uv run`; Vercel hosts it.

- `DATA.md` is the authority on the data contracts, the frame and the sources.
- `tasks.md` lists the agreed future work.
- To build the same thing for another route, use the `race-replay` skill (`~/.claude/skills/race-replay`).

## Layout

| What | Where |
|---|---|
| Race data (v1 contract) | `data/race.json`, built by `scripts/fit_to_race.py` from `rides/*.fit` (tracked on purpose) |
| Ground | `public/terrain.json` + `public/corridor/`, built by `scripts/build_terrain.py` |
| Clips | `data/media.json` + `public/media/*.mp4/.jpg`; raw phone videos in `data/videos/` (git-ignored) |
| App | `src/main.js` (HUD, sheet, clips), `src/world.js` (scene, cameras), `src/terrain.js`, `src/corridor.js`, `src/trees.js`, `src/roadside.js`, `src/atmosphere.js`, `src/director.js` (TV camera), `src/events.js`, `src/card.js` |
| Reels | `scripts/reel/` + `src/reel/` (`npm run reel`): still on branch `worktree-highlight-reel`, not yet merged |

## Rules that bite

**Frame.** `terrain.json` `bounds` are Web Mercator (EPSG:3857) metres. Local x/z are east/south
metres from the bounds centre, × cos(latitude of the centre). Every script and layer uses this one
frame; don't introduce another.

**Data, not names.**
- Events, awards, the director and the reel read the samples. Never hard-code a race time or a
  rider name in logic.
- Don't compare heart rate across riders: there are no reliable max-HR or threshold values.
- Power awards are off: rider weights aren't reliable.

**Rider colours are helmet colours.** When two riders share a helmet colour, the later one in the
data is drawn as a ring (`ring`, computed in `main.js`); there are no letters. The official clock is
race time + `clockOffset`.

**Clips.**
- Phone clocks and positions are off by up to ±9 s. Find the pass by eye from one-frame-per-second
  strips, trim so the moment is early, and write the caption from what the footage shows.
- Encode: H.264 High, yuv420p, `+faststart`, ~1.3 Mb/s, 848 px tall, mono AAC, with a poster at the pass.

**Rendering.**
- Riders are 3× life size (`RIDER_SCALE`); road, walls and trees are real size.
- The ground shader uses 14 of 16 texture units (12 corridor slots + map + relief). Don't add samplers.
- `Color.setHex` already converts sRGB to linear in r160; don't convert again.
- The world renders on demand. Anything that changes the picture while paused must mark it dirty
  (`lastKey = ''` / `sceneDirty`).
- Heavy builds yield to the browser (`breathe()`). Phones (`coarse`) and weak phones (`lite`) get
  lighter relief, fewer trees and a shorter tree reach. Keep phone load and frame rate at the
  previous level: measure it, don't assume.

**Attribution.** IGN PNOA and MDT05 are CC BY 4.0. Credit every source in `index.html` (`#credits`)
and DATA.md.

## Checking work

- `npm test` and `npm run build` before every commit.
- Look at it.
  - The desktop app's browser pane is unreliable for WebGL (hidden pane, resizes). Use headless
    Chrome via puppeteer-core with the system Chrome (`--use-angle=d3d11`), wait ~14 s after load,
    and shoot 1280×800 and 390×844 (DPR 2, mobile).
  - Another session may hold `127.0.0.1:5173`. Serve on `127.0.0.x` with `--strictPort`, and check
    which checkout answers.
- Performance: time to `data-phase="race"` and fps while playing. Compare against the previous
  branch on the same machine and viewport, and against the production build (`vite preview`).

## Git and shipping

- One branch and one PR per piece of work. Open PRs with the qute chain (`pr open`; plain
  `gh pr create` is blocked). Run the review axes first and pass the verdict with
  `--reviewed-sha` = HEAD.
- Stack PRs when they depend on each other, and merge in order. After merging the base, retarget
  the next PR to `main`.
- No force-push (a hook blocks it): to update a branch, merge `main` into it.
- Commit messages: subject `type: what changed (Tom DD.MM)`, then the `Co-Authored-By` line.
- Merging to `main` deploys to https://wielki-wyscig.vercel.app (Vercel). After a merge, check the
  commit's Vercel status, then the live site.
- Other Claude sessions work in `.claude/worktrees/*`. Don't edit a worktree you weren't handed.

# Indoor trainer (trenażer) support — research note

Status: research only, nothing built. Date: 2026-10-18. Target: PC, Chrome/Edge.

## Goal

Ride live on a smart trainer against the recorded riders in `public/race.json` as ghosts, Zwift style: pedal, the avatar moves, climbs get harder.

Today the game only replays recorded samples (`{ t, speed, watts, hr }` in `src/race.js`). A live rider produces the same shape, so the race model mostly stays.

## Connection options

| Option | Fit | Notes |
|---|---|---|
| **Web Bluetooth + FTMS** (chosen) | Smart trainers from ~2020 on: Wahoo KICKR, Tacx Neo/Flux, Elite, Saris, Zwift Hub, JetBlack | Live power/cadence/speed (Indoor Bike Data `0x2AD2`). Two-way: Control Point `0x2AD9` sets simulation (grade, wind, Crr) or ERG target watts. Chrome/Edge/Android only — not iOS Safari or Firefox. Needs HTTPS (localhost and Vercel are fine) and a user click to pair. |
| Bluetooth Cycling Power / CSC (read-only) | "Dumb" trainers with a power meter or speed sensor | Same Web Bluetooth path; estimate speed from power. No resistance control. |
| Heart Rate Service (`0x180D`) | HR straps | Same API, add alongside FTMS. |
| ANT+ via WebUSB | Older gear with a USB stick | Fiddly, Chrome-only. Only if users need it. |
| Native wrapper (Capacitor) or local WebSocket bridge | iOS | Only route to iPhone/iPad; much more to ship. |
| Import `.fit` after the ride | Anyone | What the game does already; not live. |
| Fake trainer (keyboard/slider watts) | Dev and demos | Needed for testing anyway. |

## Effort estimate (Zwift style)

### Level 1 — solo live ride vs ghosts (≈ 4–7 days)

- Bluetooth connect + parse Indoor Bike Data flags bitfield — 1 day (~200 lines).
- Send grade: Request Control (`0x00`), then Set Indoor Bike Simulation Parameters (`0x11`) about once a second. Smooth the grade first; raw elevation makes resistance jump — ½ day.
- Watts → speed physics (mass, CdA, Crr, grade). Tuning downhill and acceleration feel is the real work — ½–1 day.
- Game loop from replay to live — 1–2 days. The biggest change: `src/main.js` is driven by a playback clock with seek/scrub; live mode is driven by the rider's accumulated distance, with ghosts placed from their recorded data at the same elapsed time.
- UI: pair button, live power/cadence/HR, countdown, pause — 1 day. Existing W/bpm readouts can reuse the data.
- Fake trainer for testing — ½ day.

### Level 2 — Zwift polish (+1–3 weeks, pick and choose)

- Trainer difficulty slider (Zwift defaults to ~50% of real grade) — tiny, big effect on feel.
- Drafting behind ghosts.
- Virtual gears on the keyboard.
- ERG workouts.
- Avatar cadence animation.
- FIT export / Strava upload.

### Level 3 — live multiplayer (weeks to months)

Needs a realtime server (Vercel functions can't hold WebSockets: Cloudflare Durable Objects, PartyKit or Supabase Realtime), plus sync, lobbies and anti-cheat.

## Gotchas

- Only one app can control the trainer — close Zwift and vendor apps first.
- Pairing needs a user gesture and a secure context.
- Some older Tacx/Elite units need a firmware update for FTMS.
- Built-in Windows Bluetooth can drop connections; a USB BLE dongle helps.

## Open-source references

- **Auuki** (formerly Flux) — `github.com/dvmarinoff/Auuki`. Browser trainer app in plain JS on Web Bluetooth: FTMS parsing, control, sim and ERG modes, HR, workouts. Closest reference for Level 1.
- **Incyclist** — `github.com/incyclist`. Electron app with video routes; device layer published as npm `incyclist-devices` (BLE, ANT+, many brands).
- **Zwack** — `github.com/paixaop/zwack`. Node program that emulates a BLE smart trainer; develop without pedalling.
- **qdomyos-zwift (QZ)** — bridge for many devices; reference for brand quirks.
- **GoldenCheetah** — desktop analysis with a train mode (C++); physics and grade handling.
- **FortiusANT** — makes old Tacx Fortius trainers act as FTMS/ANT smart trainers.
- **Garmin FIT SDK** — npm `@garmin/fitsdk`, official FIT read/write for ride export.

Licences: Auuki and Incyclist are likely copyleft (GPL/AGPL) — **not verified, check each repo**. Plan is to read them for reference and write our own small FTMS client from the public Bluetooth spec rather than copy code.

## Recommended next step

Build Level 1 against the fake trainer first, then the real trainer, with the difficulty slider in from the start.

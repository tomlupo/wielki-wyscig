# Tasks

Future enhancements, agreed with Tom on 18.10 and not started. Each one is a PR of its own,
through the PR chain (see CLAUDE.md).

## 1. Rider kit: helmets, jerseys, bikes in 3D

Give the 3D riders what they wore, so a phone clip and the replay look like the same race.

- Add an optional per-rider `kit` to `data/race.json`: `{ helmet, jersey, accent, pattern, shorts, bike }`.
  Validate it in `src/data/source.js`. It must stay backwards-compatible: a rider without `kit`
  looks as now.
- Helmets are already the rider colour (`color`, PR #9). The kit adds the rest:
  - Jersey: the Icarus team kit for everyone who wore it (dark green, gold/yellow trim in the
    clips). Ask Tom for a kit photo for the exact colours.
  - Bikes: mint/teal frames for several riders; Krzys rides a red-and-black frame (IMG_7793).
- The rider colour stays on the label dot/ring, the ring under the bike, the trail and the charts.
- Riders are drawn at `RIDER_SCALE = 3`, so details must read at 3× life size from the moto camera.

## 2. End-of-race awards

Every rider goes home with something, computed from the data by rules, never hard-coded names.
Each rider gets at most one automatic award, filled in this priority order, skipping riders who
already have one. Heart rate is never compared across riders (no reliable max-HR or thresholds),
and power awards are off (weights aren't reliable).

| # | Award | Rule | On the 17.10 data |
|---|---|---|---|
| 1 | 🟡 Yellow jersey | fastest to the top | El Halcon (26:50) |
| 2 | 🟢 Green jersey | fastest final 500 m | Los Locos (1:35) |
| 3 | 🔴⚪ Polka-dot | most fastest-km splits; ties broken by the steepest km | El Szczupak (2 of 8) |
| 4 | ⬆️ Comeback | most places gained from the worst position after the first 2 min | El Lobo (7th → 5th) |
| 5 | 🔒 Locked in | longest unbroken time in one place | Krzys (4th from min 2 to the top) |
| 6 | ⚔️ Duel winner | winner of the longest wheel-to-wheel pairing (≤ 5 s) among riders without an award | Karol (beat Rafi by 8 s after 4.9 km together) |
| 7 | 🏮 Lanterne rouge | last to the top | Rafi (33:15) |

- Hand-set awards: an optional `awards` list in `race.json`, `[{ rider, item, title, reason }]`,
  shown beside the automatic ones. Seed it with
  `{ "rider": "el-lobo", "item": "klakson", "title": "Klakson", "reason": "Lost the bet to Krzysiek" }`.
- Where they show:
  - **Live:** the yellow jersey moves to the current leader; the polka-dot shows on the steepest km;
    green in the last 500 m.
  - **Results card:** each row gets its jersey or item icon.
  - **Klakson:** a horn honk and a 📯 lower third when El Lobo's clip (`el-lobo`, IMG_7794) plays,
    or when Krzys passes him if the events contain that pass. After that, a small horn on El Lobo's
    handlebar to the finish.
- Unit-test every rule against `data/race.json`: the table above is the expected output.

## Making the next route easier

Found while writing the race-replay skill (`~/.claude/skills/race-replay`). Not urgent.

- `scripts/new_route.py`: bootstrap `public/terrain.json` (`bounds`, `width`, `depth`, `route`,
  survey `texture`) from a GPX or Strava segment polyline. Today `scripts/build_terrain.py` assumes
  the file already exists; the Batalla one was made outside the repo.
- Move the route's names and texts into `data/route.json` (title, start and finish names, place,
  credits, sun direction, ride date). Today they are spread over `index.html`, `src/main.js`,
  `src/world.js` and `src/atmosphere.js`.
- `createFarLand` in `src/atmosphere.js` sketches the Tramuntana ridge and the sea for Batalla.
  A new route needs its own, or a generic one built from a coarse DEM beyond the survey.

# Race data and backend integration

The frontend loads `GET /race.json`, the static file `public/race.json` (Vercel caches it at the edge for 60 s). No upload UI or write endpoint is included.

To publish a new dataset, rebuild `public/race.json` (see Real rides below) and push to `main`.

## Version 1 contract

```json
{
  "version": 1,
  "id": "batalla-2026",
  "title": "Coll de sa Batalla",
  "simulated": false,
  "distanceM": 7781.08,
  "riders": [{
    "id": "rider-a",
    "name": "Rider A",
    "color": "#ffd34d",
    "samples": [
      {"t": 0, "d": 0, "speed": 18.5, "watts": 285, "hr": 142},
      {"t": 1560, "d": 7781.08, "speed": 19.2, "watts": 320, "hr": 168}
    ]
  }]
}
```

`t` = seconds on the race clock (see Clock below); `d` = cumulative metres along the reference climb; `speed` = km/h; `watts` = W; `hr` = bpm. Use `null` for absent sensor data. Zero watts means measured coasting, not missing data. Samples must be ordered with strictly increasing timestamps and nondecreasing distance. Each rider starts at `(t=0,d=0)` and ends at the reference segment distance. Intermediate samples are interpolated. 1–12 riders are accepted; the layout is tested with five to seven.

Optional fields: race `clockOffset` (seconds, ≥ 0) and rider `officialTime` (seconds), both explained under Clock.

### Clock

For a mass start, every rider is on one race clock: `t=0` is the first rider over the start of the reference road, and a rider still behind the line keeps `d=0` until they cross it. The mass start counts as one start for everyone, so finishing times and order follow the official times below.

Official segment times (Strava) are the result, and the replay shows them exactly. Strava's segment starts ~160 m before the reference road, so `clockOffset` (the median gap between official and GPS times, 33.7 s on 17.10) is added to every time the app shows. A rider's finish is at `officialTime − clockOffset` on the race clock; their GPS clock is nudged by a few seconds over the climb to land there. A rider with no official time gets GPS time + `clockOffset` as an estimate (Karol, 33:07 on 17.10).

Before supplying recorded data, trim each recording to the same segment and map-match its positions to the reference road; do not substitute entire-ride cumulative distance. FIT is preferred for preserving power and heart-rate channels.

The reference road is `public/terrain.json` → `route`, whose entries are `[eastMetres,southMetres,gpxAltitudeMetres,cumulativeDistanceMetres]`. Its current length is 7938.21 m: on 18.10 the start was moved 157 m earlier, along the median of the seven riders' own GPS lead-in, so that the automatic GPS times land within 2–13 s of the official Strava segment times (before, every rider came out ~47 s short). The terrain mesh uses separate DEM heights, so displayed terrain height may differ from GPX altitude.

Private repository visibility does not itself protect a deployed app. Existing Vercel Deployment Protection remains in place. Review access deliberately before adding personal activity data.

## Data sources

`loadRace()` in `src/race.js` fetches `/race.json`, checks it against the contract above (`validateRace`) and hands version-1 data to the rest (the race model, the 3D world, the HUD, the URL state, the reel). There is one source: `scripts/fit_to_race.py` turns recorded FIT or GPX rides into `public/race.json` offline (see Real rides below), in the terrain frame: the `bounds` are Web Mercator metres (EPSG:3857), and `route` x/z are east/south metres from the bounds centre, scaled by cos(latitude of the centre), so they are true metres.

A live per-rider feed would need its own loader, and a `live` flag on `validateRace` that relaxes the "ends at `distanceM`" rule. Neither exists.

## Rider colours

A rider's `color` is their helmet colour: it marks them everywhere (labels, standings, profile, trail, charts, results card). When two riders share a helmet colour, the one listed later is drawn as a ring instead of a dot, and with a dashed line on the results card's gap chart.

## URL state

`?t=<seconds>&r=<rider id>&cam=<follow|overview|side|free>&x=<1|4|16>` opens the replay at that moment and skips the intro (`src/state.js`). The Share button copies this link.

## Development

`npm ci`, `npm test`, `npm run dev`, `npm run build`.
Vite serves `public/race.json` at `/race.json` in development and preview, and copies it to `dist/` for production.

## Data attribution

- Aerial imagery: © IGN / PNOA, CC BY 4.0, https://www.ign.es/wms-inspire/pnoa-ma
- Elevation: © IGN, MDT05 (5 m, from LiDAR), CC BY 4.0, via https://servicios.idee.es/wcs-inspire/mdt
- Road corridor imagery: © IGN / PNOA 25 cm, CC BY 4.0, same WMS as above, in `public/corridor/`.
- Trees: detected from that imagery (dark green crowns), so they stand where real trees do; species and height are estimated.
- Road: https://mallorcavelo.com/gpx/serra-de-tramuntana-nord.gpx ; OpenStreetMap contributors, ODbL. Extract reversed to climb Caimari → summit.
- `public/race.json` holds recorded rides (`"simulated": false`). When a dataset is marked simulated, its rider metrics are synthetic and are not physiological or performance estimates for real people.

Aerial imagery is draped over a finite ~6 × 9 km terrain mesh. This is not street-level photogrammetry. Vertical scale is 1:1. Riders are drawn 3× life size; the road (6 m), walls and trees are real size. Walls and guardrails are placed where the ground falls away beside the road, not from a survey.

## Ground: `scripts/build_terrain.py`

`uv run scripts/build_terrain.py` rebuilds the measured ground from IGN open data (`dem`, `tiles`, `trees` steps; downloads cached in `.cache/terrain/`):

- `dem`: MDT05 averaged onto a 15 m grid → `public/terrain.json` `nx`/`ny`/`heights`. It prints the mean offset from the road's GPX altitude (0.0 m, 95% within 4.5 m on the current data).
- `tiles`: 25 cm orthophoto, 256 m tiles within 170 m of the road → `public/corridor/hi/` (1024 px, desktop) and `lo/` (512 px, phones). The ground shader shows the 12 tiles nearest the camera and its subject (`src/corridor.js`).
- `trees`: crowns found in those tiles → `public/corridor/index.json` (`src/trees.js`).

The survey-wide aerial texture in `terrain.json` (~4.75 m/px) is unchanged; the corridor tiles sit on top of it near the road.

## Real rides: `scripts/fit_to_race.py`

`uv run scripts/fit_to_race.py --mass-start "El Lobo=rides/el-lobo.fit:#ffd34d@31:34" "Name=rides/x.gpx:#4fc3f7"` rebuilds `public/race.json` from FIT or GPX files (whole rides are fine). `@MM:SS` is the rider's official segment time. It finds the climb by matching GPS to `route`, cuts at the first arrival at the summit (a café stop at the top does not count), times the start and summit crossings between GPS points, and puts everyone on one clock (see Clock). The raw rides are kept in the repository under `rides/` (one FIT file per rider, ~5 MB for 17.10), so `public/race.json` can be rebuilt and re-checked at any time. They are whole rides with personal data (home location, weight, heart-rate zones): the site never serves them (they are outside `public/`), and only the trimmed climb in `public/race.json` is published.

17.10 was built with:

```
uv run scripts/fit_to_race.py --mass-start "El Lobo=rides/el-lobo.fit:#e53935@31:34" "Los Locos=rides/los-locos.fit:#f2f2ee@26:59" "El Szczupak=rides/el-szczupak.fit:#3d8bfd@28:05" "Krzys=rides/krzys.fit:#9ea4ad@30:29" "Rafi=rides/rafi.fit:#f2f2ee@33:15" "El Halcon=rides/el-halcon.fit:#ff8a1f@26:50" "Karol=rides/karol.fit:#9ea4ad"
```

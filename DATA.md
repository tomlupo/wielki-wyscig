# Race data and backend integration

The production frontend loads `GET /api/race`. The Vercel function reads `data/race.json`. No upload UI or unauthenticated write endpoint is included.

For now, replace `data/race.json` through GitHub/backend tooling and push to `main` to publish a new dataset. Later the API can read an object store or database without changing the renderer.

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

`t` = seconds since this rider entered the segment; `d` = cumulative metres along the reference climb; `speed` = km/h; `watts` = W; `hr` = bpm. Use `null` for absent sensor data. Zero watts means measured coasting, not missing data. Samples must be ordered with strictly increasing timestamps and nondecreasing distance. Each rider starts at `(t=0,d=0)` and ends at the reference segment distance. Intermediate samples are interpolated. 1–12 riders are accepted; the layout is tested with five to seven.

This release aligns everyone at the segment start. It does not yet parse FIT/GPX/TCX or support absolute-time starts. Before supplying recorded data, trim each recording to the same segment and map-match its positions to the reference road; do not substitute entire-ride cumulative distance. FIT is preferred for preserving power and heart-rate channels.

The reference road is `public/terrain.json` → `route`, whose entries are `[eastMetres,southMetres,gpxAltitudeMetres,cumulativeDistanceMetres]`. Its current length is 7781.08 m; boundaries are approximate, not verified against a specific Strava segment. The terrain mesh uses separate DEM heights, so displayed terrain height may differ from GPX altitude.

Private repository visibility does not itself protect a deployed app. Existing Vercel Deployment Protection remains in place. Review access deliberately before adding personal activity data.

## Data sources (the one seam)

`src/data/source.js` is the only place the app learns where race data comes from. A **RaceSource** is `{ load(): Promise<RaceV1> }`. `loadRace(source)` validates the result against the contract above. Everything after that point (the race model, the 3D world, the HUD, the URL state) only sees version-1 data.

- **Today:** `simulatedSource()` → `GET /api/race` → `data/race.json` (recorded rides, or synthetic riders when `simulated` is true).
- **GPX / FIT files:** write `gpxSource(files)` that returns a RaceV1. For each rider:
  1. Parse the track points.
  2. Project lat/lon into the terrain frame.
  3. Map-match each point to the nearest `route` vertex to get `d`.
  4. Trim to the segment, so that `d` runs from 0 to `distanceM`.
  5. Rebase `t` to 0 at the segment start.
  6. Keep `watts` and `hr` from the extensions. Use `null` when they are absent.

  The terrain `bounds` are Web Mercator metres (EPSG:3857). `route` x/z are east/south metres from the bounds centre, scaled by cos(latitude of the centre), so they are true metres. `scripts/fit_to_race.py` and `scripts/build_terrain.py` both use this.
- **Live per-rider feed:** write a source whose `load()` returns the current snapshot. To get updates, add `subscribe(onRace)`, and rebuild the race model on each update. Live riders have not reached the summit yet, so `validateRace` needs a `live` flag that relaxes the "ends at `distanceM`" rule. This flag does not exist yet.

Swap the source in one line in `src/main.js` (`loadRace()` → `loadRace(gpxSource(...))`).

## URL state

`?t=<seconds>&r=<rider id>&cam=<follow|overview|side|free>&x=<1|4|16>` opens the replay at that moment and skips the intro (`src/state.js`). The Share button copies this link.

## Development

`npm ci`, `npm test`, `npm run dev`, `npm run build`.
Vite's development middleware serves the same `/api/race` contract. Production uses `api/race.js`.

## Data attribution

- Aerial imagery: © IGN / PNOA, CC BY 4.0, https://www.ign.es/wms-inspire/pnoa-ma
- Elevation: © IGN, MDT05 (5 m, from LiDAR), CC BY 4.0, via https://servicios.idee.es/wcs-inspire/mdt
- Road corridor imagery: © IGN / PNOA 25 cm, CC BY 4.0, same WMS as above, in `public/corridor/`.
- Trees: detected from that imagery (dark green crowns), so they stand where real trees do; species and height are estimated.
- Road: https://mallorcavelo.com/gpx/serra-de-tramuntana-nord.gpx ; OpenStreetMap contributors, ODbL. Extract reversed to climb Caimari → summit.
- `data/race.json` holds recorded rides (`"simulated": false`). When a dataset is marked simulated, its rider metrics are synthetic and are not physiological or performance estimates for real people.

Aerial imagery is draped over a finite ~6 × 9 km terrain mesh. This is not street-level photogrammetry. Vertical scale is 1:1. Riders are drawn 3× life size; the road (6 m), walls and trees are real size. Walls and guardrails are placed where the ground falls away beside the road, not from a survey.

## Ground: `scripts/build_terrain.py`

`uv run scripts/build_terrain.py` rebuilds the measured ground from IGN open data (`dem`, `tiles`, `trees` steps; downloads cached in `.cache/terrain/`):

- `dem`: MDT05 averaged onto a 15 m grid → `public/terrain.json` `nx`/`ny`/`heights`. It prints the mean offset from the road's GPX altitude (0.0 m, 95% within 4.5 m on the current data).
- `tiles`: 25 cm orthophoto, 256 m tiles within 170 m of the road → `public/corridor/hi/` (1024 px, desktop) and `lo/` (512 px, phones). The ground shader shows the 12 tiles nearest the camera and its subject (`src/corridor.js`).
- `trees`: crowns found in those tiles → `public/corridor/index.json` (`src/trees.js`).

The survey-wide aerial texture in `terrain.json` (~4.75 m/px) is unchanged; the corridor tiles sit on top of it near the road.

## Real rides: `scripts/fit_to_race.py`

`uv run scripts/fit_to_race.py "El Lobo=rides/el-lobo.fit" "Name=rides/x.gpx:#4fc3f7"` rebuilds `data/race.json` from FIT or GPX files (whole rides are fine). It finds the climb by matching GPS to `route`, cuts at the first arrival at the summit (a café stop at the top does not count), and stretches distance onto the reference road. Raw ride files stay in `rides/`, which is git-ignored: only the trimmed climb is published.

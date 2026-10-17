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

`t` = seconds since this rider entered the segment; `d` = cumulative metres along the reference climb; `speed` = km/h; `watts` = W; `hr` = bpm. Use `null` for absent sensor data. Zero watts means measured coasting, not missing data. Samples must be ordered with strictly increasing timestamps and nondecreasing distance. Each rider starts at `(t=0,d=0)` and ends at the reference segment distance. Intermediate samples are interpolated. 1–12 riders are accepted; the demo layout is optimized for five.

This release aligns everyone at the segment start. It does not yet parse FIT/GPX/TCX or support absolute-time starts. Before supplying recorded data, trim each recording to the same segment and map-match its positions to the reference road; do not substitute entire-ride cumulative distance. FIT is preferred for preserving power and heart-rate channels.

The reference road is `public/terrain.json` → `route`, whose entries are `[eastMetres,southMetres,gpxAltitudeMetres,cumulativeDistanceMetres]`. Its current length is 7781.08 m; boundaries are approximate, not verified against a specific Strava segment. The terrain mesh uses separate DEM heights, so displayed terrain height may differ from GPX altitude.

Private repository visibility does not itself protect a deployed app. Existing Vercel Deployment Protection remains in place. Review access deliberately before adding personal activity data.

## Data sources (the one seam)

`src/data/source.js` is the only place the app learns where race data comes from. A **RaceSource** is `{ load(): Promise<RaceV1> }`. `loadRace(source)` validates the result against the contract above. Everything after that point (the race model, the 3D world, the HUD, the URL state) only sees version-1 data.

- **Today:** `simulatedSource()` → `GET /api/race` → `data/race.json` (synthetic riders).
- **GPX / FIT files:** write `gpxSource(files)` that returns a RaceV1. For each rider:
  1. Parse the track points.
  2. Project lat/lon into the terrain frame.
  3. Map-match each point to the nearest `route` vertex to get `d`.
  4. Trim to the segment, so that `d` runs from 0 to `distanceM`.
  5. Rebase `t` to 0 at the segment start.
  6. Keep `watts` and `hr` from the extensions. Use `null` when they are absent.

  The terrain `bounds` are projected metres (UTM, EPSG:25831), and `route` x/z are east/south metres from the terrain centre. Validate that projection against the source GPX before you trust it.
- **Live per-rider feed:** write a source whose `load()` returns the current snapshot. To get updates, add `subscribe(onRace)`, and rebuild the race model on each update. Live riders have not reached the summit yet, so `validateRace` needs a `live` flag that relaxes the "ends at `distanceM`" rule. This flag does not exist yet.

Swap the source in one line in `src/main.js` (`loadRace()` → `loadRace(gpxSource(...))`).

## URL state

`?t=<seconds>&r=<rider id>&cam=<follow|overview|side|free>&x=<1|4|16>` opens the replay at that moment and skips the intro (`src/state.js`). The Share button copies this link.

## Development

`npm ci`, `npm test`, `npm run dev`, `npm run build`.
Vite's development middleware serves the same `/api/race` contract. Production uses `api/race.js`.

## Data attribution

- Aerial imagery: © IGN / PNOA, CC BY 4.0, https://www.ign.es/wms-inspire/pnoa-ma
- Elevation: Mapzen/AWS Terrain Tiles, https://registry.opendata.aws/terrain-tiles/ (see contributing-source attribution at https://github.com/tilezen/joerd/blob/master/docs/attribution.md).
- Road: https://mallorcavelo.com/gpx/serra-de-tramuntana-nord.gpx ; OpenStreetMap contributors, ODbL. Extract reversed to climb Caimari → summit.
- All demo rider metrics are synthetic and are not physiological or performance estimates for real people.

Aerial imagery is draped over a finite ~6 × 9 km terrain mesh. This is not street-level photogrammetry. Vertical scale is 1:1; markers and route width are enlarged for readability.

## Real rides: `scripts/fit_to_race.py`

`uv run scripts/fit_to_race.py "El Lobo=rides/el-lobo.fit" "Name=rides/x.gpx:#4fc3f7"` rebuilds `data/race.json` from FIT or GPX files (whole rides are fine). It finds the climb by matching GPS to `route`, cuts at the first arrival at the summit (a café stop at the top does not count), and stretches distance onto the reference road. Raw ride files stay in `rides/`, which is git-ignored: only the trimmed climb is published.

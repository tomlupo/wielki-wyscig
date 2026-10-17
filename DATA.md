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

## Development

`npm ci`, `npm test`, `npm run dev`, `npm run build`.
Vite's development middleware serves the same `/api/race` contract. Production uses `api/race.js`.

## Data attribution

- Aerial imagery: © IGN / PNOA, CC BY 4.0, https://www.ign.es/wms-inspire/pnoa-ma
- Elevation: Mapzen/AWS Terrain Tiles, https://registry.opendata.aws/terrain-tiles/ (see contributing-source attribution at https://github.com/tilezen/joerd/blob/master/docs/attribution.md).
- Road: https://mallorcavelo.com/gpx/serra-de-tramuntana-nord.gpx ; OpenStreetMap contributors, ODbL. Extract reversed to climb Caimari → summit.
- All demo rider metrics are synthetic and are not physiological or performance estimates for real people.

Aerial imagery is draped over a finite ~6 × 9 km terrain mesh. This is not street-level photogrammetry. Vertical scale is 1:1; markers and route width are enlarged for readability.

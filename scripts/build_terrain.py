# /// script
# dependencies = ["numpy>=1.26", "pyproj>=3.6", "pillow>=10", "tifffile>=2024.1", "imagecodecs>=2024.1"]
# ///
"""Rebuild the measured ground from IGN open data (both CC BY 4.0, © Instituto Geográfico Nacional).

  uv run scripts/build_terrain.py            # all steps
  uv run scripts/build_terrain.py dem        # only the elevation
  uv run scripts/build_terrain.py tiles trees

dem    MDT05 (5 m, LiDAR) from the IDEE WCS, resampled onto the terrain frame at GRID metres,
       replaces public/terrain.json `nx`, `ny`, `heights` (uint16 decimetres, base64).
tiles  PNOA 25 cm orthophoto along the road, TILE-metre squares within CORRIDOR m of it:
       public/corridor/hi/<i>_<j>.webp (1024 px, 0.25 m) and lo/ (512 px, 0.5 m).
trees  tree crowns found in those tiles (dark green blobs) → public/corridor/index.json.

Frame (see DATA.md): `bounds` are Web Mercator (EPSG:3857) metres; local x/z are east/south
metres from the bounds centre, scaled by cos(latitude of the centre). The aerial texture and
`route` stay as they are. Downloads are cached in .cache/terrain/ (git-ignored).
"""

import base64, io, json, math, sys, urllib.request
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
TERRAIN = ROOT / "public" / "terrain.json"
OUT = ROOT / "public" / "corridor"
CACHE = ROOT / ".cache" / "terrain"
GRID = 15.0  # m between height samples (the 5 m DEM is area-averaged onto it)
TILE = 256.0  # m, corridor tile edge
CORRIDOR = 170.0  # m either side of the road that gets 25 cm imagery
TREE_REACH = 160.0  # m from the road that gets 3D trees
ROAD_CLEAR = (
    6.5  # m from the road centre kept free of trees (the canopy over the lane is cut)
)

WCS = "https://servicios.idee.es/wcs-inspire/mdt?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=Elevacion4258_5&FORMAT=image/tiff"
WMS = "https://www.ign.es/wms-inspire/pnoa-ma?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=OI.OrthoimageCoverage&STYLES=&CRS=EPSG:3857&FORMAT=image/jpeg"

to_geo = Transformer.from_crs(3857, 4258, always_xy=True)


def fetch(url, name):
    path = CACHE / name
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(
            url, headers={"User-Agent": "wielki-wyscig terrain build"}
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
        if data[:5] in (b"<?xml", b"<Serv", b"<ows:"):
            raise RuntimeError(
                f"{name}: service error\n{data[:400].decode(errors='replace')}"
            )
        path.write_bytes(data)
    return path.read_bytes()


class Frame:
    def __init__(self, t):
        b = t["bounds"]
        self.cx, self.cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        self.k = math.cos(2 * math.atan(math.exp(self.cy / 6378137)) - math.pi / 2)
        self.width, self.depth = t["width"], t["depth"]

    def merc(self, x, z):  # local metres → EPSG:3857
        return self.cx + np.asarray(x) / self.k, self.cy - np.asarray(z) / self.k


def load():
    return json.loads(TERRAIN.read_text())


# ---- elevation -----------------------------------------------------------------------------
def build_dem(t):
    f = Frame(t)
    corners = f.merc([-f.width / 2, f.width / 2], [f.depth / 2, -f.depth / 2])
    lon, lat = to_geo.transform(*corners)
    lon0, lon1, lat0, lat1 = (
        lon[0] - 0.003,
        lon[1] + 0.003,
        lat[0] - 0.003,
        lat[1] + 0.003,
    )
    # The WCS caps the size of one response: fetch a grid of chunks and mosaic them.
    step = 0.04
    rows = []
    la = lat1
    while la > lat0:
        row = []
        lo = lon0
        while lo < lon1:
            name = f"dem_{lo:.3f}_{la:.3f}.tif"
            url = f"{WCS}&SUBSET=Lat({la - step:.5f},{la:.5f})&SUBSET=Long({lo:.5f},{lo + step:.5f})"
            tif = tifffile.TiffFile(io.BytesIO(fetch(url, name)))
            page = tif.pages[0]
            sx, sy = page.tags["ModelPixelScaleTag"].value[:2]
            tie = page.tags["ModelTiepointTag"].value
            row.append((page.asarray().astype(np.float32), tie[3], tie[4], sx, sy))
            lo += step
        rows.append(row)
        la -= step
    sx, sy = rows[0][0][3], rows[0][0][4]
    west, north = rows[0][0][1], rows[0][0][2]
    W = round((rows[0][-1][1] - west) / sx) + rows[0][-1][0].shape[1]
    H = round((north - rows[-1][0][2]) / sy) + rows[-1][0][0].shape[0]
    dem = np.full((H, W), np.nan, np.float32)
    for row in rows:
        for a, lo, la, _, _ in row:
            c, r = round((lo - west) / sx), round((north - la) / sy)
            dem[r : r + a.shape[0], c : c + a.shape[1]] = a[: H - r, : W - c]
    dem[dem < -100] = np.nan
    print(
        f"DEM mosaic {W}×{H}, {np.nanmin(dem):.0f}–{np.nanmax(dem):.0f} m",
        file=sys.stderr,
    )

    # an even number of cells each way, so a weak phone can take every second sample
    nx, ny = 2 * round(f.width / GRID / 2) + 1, 2 * round(f.depth / GRID / 2) + 1
    xs = np.linspace(-f.width / 2, f.width / 2, nx)
    zs = np.linspace(-f.depth / 2, f.depth / 2, ny)
    X, Z = np.meshgrid(xs, zs)
    out = np.zeros_like(X)
    # Area average over the GRID cell (a 3×3 stencil of 5 m samples): no aliasing, no 1 m terraces.
    for ox in (-GRID / 3, 0, GRID / 3):
        for oz in (-GRID / 3, 0, GRID / 3):
            lon, lat = to_geo.transform(*f.merc(X + ox, Z + oz))
            u, v = (lon - west) / sx - 0.5, (north - lat) / sy - 0.5
            a, b = np.floor(u).astype(int), np.floor(v).astype(int)
            fx, fy = u - a, v - b
            a, b = np.clip(a, 0, W - 2), np.clip(b, 0, H - 2)
            out += (dem[b, a] * (1 - fx) + dem[b, a + 1] * fx) * (1 - fy) + (
                dem[b + 1, a] * (1 - fx) + dem[b + 1, a + 1] * fx
            ) * fy
    out /= 9
    sea = np.isnan(out)
    out[sea] = 0
    print(
        f"grid {nx}×{ny} at {GRID} m ({sea.sum()} cells outside the survey → 0 m)",
        file=sys.stderr,
    )

    # Compare with the road's own altitude: the mean offset should be small.
    route = np.array(t["route"])
    i = np.clip(np.round((route[:, 0] + f.width / 2) / (f.width / (nx - 1))).astype(int), 0, nx - 1)
    j = np.clip(np.round((route[:, 1] + f.depth / 2) / (f.depth / (ny - 1))).astype(int), 0, ny - 1)
    diff = out[j, i] - route[:, 2]
    print(
        f"DEM − GPX altitude along the road: mean {diff.mean():+.1f} m, p95 |Δ| {np.percentile(abs(diff), 95):.1f} m",
        file=sys.stderr,
    )

    q = np.clip(np.round(out * 10), 0, 65535).astype("<u2")
    t["nx"], t["ny"] = nx, ny
    t["heights"] = base64.b64encode(q.tobytes()).decode()
    t["heightsSource"] = f"IGN MDT05 (5 m LiDAR), area-averaged to {GRID:g} m"
    return t


# ---- corridor imagery ----------------------------------------------------------------------
def seg_dist(px, pz, route):
    """Distance from each point to the road polyline."""
    a, b = route[:-1, :2], route[1:, :2]
    best = np.full(px.shape, np.inf)
    for s in range(0, len(a), 256):
        A, B = a[s : s + 256], b[s : s + 256]
        AB = B - A
        L = np.maximum((AB**2).sum(1), 1e-9)
        tx = (
            (px[..., None] - A[:, 0]) * AB[:, 0] + (pz[..., None] - A[:, 1]) * AB[:, 1]
        ) / L
        tx = np.clip(tx, 0, 1)
        dx = px[..., None] - (A[:, 0] + tx * AB[:, 0])
        dz = pz[..., None] - (A[:, 1] + tx * AB[:, 1])
        best = np.minimum(best, np.sqrt(dx * dx + dz * dz).min(-1))
    return best


def corridor_tiles(t):
    f = Frame(t)
    route = np.array(t["route"])
    ni, nj = math.ceil(f.width / TILE), math.ceil(f.depth / TILE)
    tiles = []
    for j in range(nj):
        for i in range(ni):
            x0, z0 = -f.width / 2 + i * TILE, -f.depth / 2 + j * TILE
            # sample the tile on a 9×9 lattice: near enough for a 170 m corridor
            g = np.linspace(0, TILE, 9)
            px, pz = np.meshgrid(x0 + g, z0 + g)
            if seg_dist(px, pz, route).min() < CORRIDOR:
                tiles.append((i, j))
    return tiles


def build_tiles(t):
    f = Frame(t)
    tiles = corridor_tiles(t)
    print(f"{len(tiles)} corridor tiles of {TILE:g} m", file=sys.stderr)
    for d in ("hi", "lo"):
        (OUT / d).mkdir(parents=True, exist_ok=True)
    total = 0
    for n, (i, j) in enumerate(tiles):
        x0, z0 = -f.width / 2 + i * TILE, -f.depth / 2 + j * TILE
        (mx0, mx1), (my1, my0) = f.merc([x0, x0 + TILE], [z0, z0 + TILE])
        url = (
            f"{WMS}&BBOX={mx0:.2f},{my0:.2f},{mx1:.2f},{my1:.2f}&WIDTH=1024&HEIGHT=1024"
        )
        img = Image.open(io.BytesIO(fetch(url, f"pnoa_{i}_{j}.jpg"))).convert("RGB")
        hi, lo = OUT / "hi" / f"{i}_{j}.webp", OUT / "lo" / f"{i}_{j}.webp"
        img.save(hi, "WEBP", quality=72, method=6)
        img.resize((512, 512), Image.LANCZOS).save(lo, "WEBP", quality=74, method=6)
        total += hi.stat().st_size + lo.stat().st_size
        if n % 10 == 9:
            print(f"  {n + 1}/{len(tiles)}", file=sys.stderr)
    print(f"tiles: {total / 1e6:.1f} MB", file=sys.stderr)
    return tiles


# ---- trees -----------------------------------------------------------------------------------
def box(a, r):
    """Mean over a (2r+1)² window (summed-area table)."""
    p = np.pad(a, r + 1, mode="edge").cumsum(0).cumsum(1)
    k = 2 * r + 1
    return (p[k:, k:] - p[:-k, k:] - p[k:, :-k] + p[:-k, :-k])[
        : a.shape[0], : a.shape[1]
    ] / (k * k)


def find_trees(t, tiles):
    """Crowns: dark, green-leaning blobs at 0.5 m. One tree per local maximum of crown cover."""
    f = Frame(t)
    route = np.array(t["route"])
    trees = []
    for i, j in tiles:
        img = np.asarray(
            Image.open(OUT / "lo" / f"{i}_{j}.webp").convert("RGB")
        ).astype(np.float32)
        R, G, B = img[..., 0], img[..., 1], img[..., 2]
        lum = 0.3 * R + 0.59 * G + 0.11 * B
        # Pines and holm oaks read dark olive from above; bare limestone, road and dry grass are bright;
        # cast shadows are dark too but not green, so they fail the green test.
        crown = ((lum < 105) & (G >= R - 4) & (G > B + 4) & (lum > 18)).astype(
            np.float32
        )
        cover = box(crown, 3)  # 3.5 m window
        peak = cover >= 0.68
        # non-maximum suppression on a 5 m grid: the densest pixel per cell
        cell = 10
        H, W = cover.shape
        for cy in range(0, H, cell):
            for cx in range(0, W, cell):
                blk = np.where(
                    peak[cy : cy + cell, cx : cx + cell],
                    cover[cy : cy + cell, cx : cx + cell],
                    0,
                )
                if blk.max() <= 0:
                    continue
                py, px = np.unravel_index(blk.argmax(), blk.shape)
                py, px = cy + py, cx + px
                # crown radius: how far the cover stays above half
                r = 0.9
                for rr in (2, 3, 4, 6):
                    if (
                        box(
                            crown[
                                max(0, py - rr) : py + rr + 1,
                                max(0, px - rr) : px + rr + 1,
                            ],
                            0,
                        ).mean()
                        > 0.55
                    ):
                        r = rr * 0.5 + 0.25
                x = -f.width / 2 + i * TILE + (px + 0.5) / W * TILE
                z = -f.depth / 2 + j * TILE + (py + 0.5) / H * TILE
                trees.append((x, z, r, float(lum[py, px])))
    trees = np.array(trees)
    d = seg_dist(trees[:, 0], trees[:, 1], route)
    keep = (d > ROAD_CLEAR) & (d < TREE_REACH)
    trees = trees[keep]
    print(f"trees: {len(trees)} within {TREE_REACH:g} m of the road", file=sys.stderr)
    return trees


def write_index(tiles, trees):
    # x, z in decimetres, crown radius in decimetres, kind 0 = pine (dark crown), 1 = holm oak / olive, 2 = low scrub (small crown)
    flat = []
    for x, z, r, lum in trees:
        flat += [round(x * 10), round(z * 10), round(r * 10), 2 if r < 1.9 else 0 if lum < 62 else 1]
    index = {
        "tile": TILE,
        "tiles": [list(t) for t in tiles],
        "trees": flat,
        "source": "PNOA 25 cm orthophoto © IGN, CC BY 4.0; tree crowns detected from it",
    }
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    print(f"wrote {(OUT / 'index.json').relative_to(ROOT)}", file=sys.stderr)


def main(steps):
    t = load()
    if "dem" in steps:
        t = build_dem(t)
        TERRAIN.write_text(json.dumps(t, separators=(",", ":")))
        print(
            f"wrote {TERRAIN.relative_to(ROOT)} ({TERRAIN.stat().st_size / 1e6:.2f} MB)",
            file=sys.stderr,
        )
    tiles = build_tiles(t) if "tiles" in steps else corridor_tiles(t)
    if "trees" in steps:
        write_index(tiles, find_trees(t, tiles))


if __name__ == "__main__":
    main(set(sys.argv[1:]) or {"dem", "tiles", "trees"})

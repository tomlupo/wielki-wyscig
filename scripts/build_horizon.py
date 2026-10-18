# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy>=1.26", "pillow>=10"]
# ///
"""Build public/horizon.json: a coarse height grid far around the climb, for the horizon.

    uv run scripts/build_horizon.py

The survey terrain (public/terrain.json) covers about 6 x 9 km. Beyond it the
3D view shows this grid: the rest of the Serra de Tramuntana, the plain and
the sea. Source: AWS Terrain Tiles (Terrarium PNG, open data, no key), zoom 11.

Frame: the same as terrain.json. The grid centre is the terrain bounds centre
(Web Mercator, EPSG:3857); x is east, z is south, in metres scaled by
cos(latitude of the centre), so the grid lines up with `route` and the mesh.
Heights are whole metres as int16, sea below zero clamped to -40.
"""

from __future__ import annotations

import base64
import io
import json
import math
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TERRAIN = ROOT / "public" / "terrain.json"
OUT = ROOT / "public" / "horizon.json"
ZOOM = 11
N = 320  # grid points per side
SIZE_M = 64000.0  # real metres per side
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
HALF = 20037508.342789244  # Web Mercator half extent


def tile(z: int, x: int, y: int) -> np.ndarray:
    with urllib.request.urlopen(URL.format(z=z, x=x, y=y), timeout=30) as r:
        rgb = np.asarray(
            Image.open(io.BytesIO(r.read())).convert("RGB"), dtype=np.float64
        )
    return rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768


def main() -> None:
    t = json.loads(TERRAIN.read_text())
    x0, y0, x1, y1 = t["bounds"]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    scale = t["width"] / (x1 - x0)  # cos(latitude), real metres per Mercator metre
    half_merc = SIZE_M / 2 / scale
    tile_m = 2 * HALF / 2**ZOOM
    tx0, tx1 = (
        int((cx - half_merc + HALF) // tile_m),
        int((cx + half_merc + HALF) // tile_m),
    )
    ty0, ty1 = (
        int((HALF - (cy + half_merc)) // tile_m),
        int((HALF - (cy - half_merc)) // tile_m),
    )
    mosaic = np.vstack(
        [
            np.hstack([tile(ZOOM, x, y) for x in range(tx0, tx1 + 1)])
            for y in range(ty0, ty1 + 1)
        ]
    )
    px = mosaic.shape[1] / ((tx1 - tx0 + 1) * tile_m)  # pixels per Mercator metre
    # Grid point (i, j): east = (i/(N-1) - 0.5) * SIZE_M, south = (j/(N-1) - 0.5) * SIZE_M (real metres).
    f = np.linspace(-0.5, 0.5, N) * SIZE_M / scale
    mx, my = cx + f[None, :], cy - f[:, None]
    u = (mx + HALF - tx0 * tile_m) * px - 0.5
    v = (HALF - my - ty0 * tile_m) * px - 0.5
    a, b = np.floor(u).astype(int), np.floor(v).astype(int)
    fu, fv = u - a, v - b
    m = mosaic
    h = (m[b, a] * (1 - fu) + m[b, a + 1] * fu) * (1 - fv) + (
        m[b + 1, a] * (1 - fu) + m[b + 1, a + 1] * fu
    ) * fv
    h = np.clip(np.round(h), -40, 3000).astype("<i2")
    OUT.write_text(
        json.dumps(
            {
                "n": N,
                "size": SIZE_M,
                "source": "AWS Terrain Tiles (Terrarium), zoom 11",
                "heights": base64.b64encode(h.tobytes()).decode(),
            }
        )
    )
    print(
        f"{OUT.name}: {N}x{N}, {h.min()}..{h.max()} m, sea {np.mean(h <= 0):.0%}, {OUT.stat().st_size // 1024} KB"
    )


if __name__ == "__main__":
    main()

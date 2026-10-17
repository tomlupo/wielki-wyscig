# /// script
# requires-python = ">=3.10"
# dependencies = ["fitparse>=1.2", "pyproj>=3.6", "numpy>=1.26"]
# ///
"""Build data/race.json from recorded rides (FIT or GPX), one file per rider.

    uv run scripts/fit_to_race.py "El Lobo=rides/lobo.fit" "Krzysiek=rides/krzys.gpx:#4fc3f7"

Each argument is NAME=PATH[:#colour]. Whole rides are fine: the climb is found
automatically by matching GPS points to the reference road in
public/terrain.json (`route`), and cut at the FIRST arrival at the summit, so a
café stop at the top does not count.

Projection: terrain `bounds` are Web Mercator (EPSG:3857) metres; `route` x/z
are east/south metres from the bounds centre, scaled by cos(latitude of the
centre). Checked against terrain width/depth to < 1 mm, and against a real ride
(17.10, El Lobo: 94 % of points within 25 m of the road).

Output follows the version-1 contract in DATA.md: 5-second samples,
t from 0, d along the reference road from 0 to distanceM (the GPS distance is
stretched to the reference length so riders compare on the same road).
"""

from __future__ import annotations

import datetime as dt
import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from pyproj import Transformer

ROOT = Path(__file__).resolve().parent.parent
TERRAIN = ROOT / "public" / "terrain.json"
OUT = ROOT / "data" / "race.json"
STEP_S = 5
NEAR_M = 25.0  # a point closer than this to the road counts as "on the climb"
END_M = 25.0  # within this of the summit vertex = arrived
PALETTE = [
    "#ffd34d",
    "#4fc3f7",
    "#ef5350",
    "#66bb6a",
    "#ab47bc",
    "#ff8a65",
    "#26c6da",
    "#d4e157",
    "#ec407a",
    "#8d6e63",
    "#78909c",
    "#ffa726",
]


def read_fit(path: Path) -> list[dict]:
    import fitparse

    rows = []
    for m in fitparse.FitFile(str(path)).get_messages("record"):
        v = m.get_values()
        if v.get("position_lat") is None or v.get("timestamp") is None:
            continue
        rows.append(
            {
                "t": v["timestamp"],
                "lat": v["position_lat"] * 180 / 2**31,
                "lon": v["position_long"] * 180 / 2**31,
                "hr": v.get("heart_rate"),
                "w": v.get("power"),
            }
        )
    return rows


def read_gpx(path: Path) -> list[dict]:
    rows = []
    for el in ET.parse(path).iter():
        if not el.tag.endswith("trkpt"):
            continue
        row = {
            "lat": float(el.get("lat")),
            "lon": float(el.get("lon")),
            "t": None,
            "hr": None,
            "w": None,
        }
        for c in el.iter():
            tag = c.tag.split("}")[-1].lower()
            if tag == "time":
                row["t"] = dt.datetime.fromisoformat(
                    c.text.replace("Z", "+00:00")
                ).replace(tzinfo=None)
            elif tag == "hr":
                row["hr"] = int(float(c.text))
            elif tag in ("power", "watts"):
                row["w"] = int(float(c.text))
        if row["t"] is not None:
            rows.append(row)
    return rows


def project(rows, terrain):
    b = terrain["bounds"]
    cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    lat0 = 2 * math.atan(math.exp(cy / 6378137)) - math.pi / 2
    k = math.cos(lat0)
    x, y = Transformer.from_crs(4326, 3857, always_xy=True).transform(
        [r["lon"] for r in rows], [r["lat"] for r in rows]
    )
    return np.stack([(np.asarray(x) - cx) * k, -(np.asarray(y) - cy) * k], 1)


def along_route(P, route):
    """Distance along the road of each point's projection, and its offset from the road."""
    A, B = route[:-1, :2], route[1:, :2]
    AB = B - A
    L2 = (AB**2).sum(1)
    t = np.clip((((P[:, None, :] - A[None]) * AB[None]).sum(-1)) / L2[None], 0, 1)
    Q = A[None] + t[..., None] * AB[None]
    off = np.sqrt(((P[:, None, :] - Q) ** 2).sum(-1))
    j = off.argmin(1)
    i = np.arange(len(P))
    return route[j, 3] + t[i, j] * (route[j + 1, 3] - route[j, 3]), off[i, j]


def climb(rows, terrain):
    route = np.asarray(terrain["route"], float)
    total = route[-1, 3]
    d, off = along_route(project(rows, terrain), route)
    near = off < NEAR_M
    at_end = np.flatnonzero(near & (d >= total - END_M))
    if not len(at_end):
        raise SystemExit("never reaches the summit of the reference road")
    for e in at_end:  # first summit arrival that has a start before it
        starts = np.flatnonzero(near[:e] & (d[:e] <= END_M))
        if len(starts):
            s = starts[-1]
            break
    else:
        raise SystemExit("summit reached but no start of the climb before it")
    # The summit is the first moment the rider tops out, not where they stop:
    # cut at the first point within END_M of the highest road distance reached.
    top = d[s : e + 1].max()
    e = s + int(np.flatnonzero(d[s : e + 1] >= top - END_M)[0])
    seg = slice(s, e + 1)
    on = near[seg].mean()
    if on < 0.8:
        raise SystemExit(f"only {on:.0%} of the window is on the road; wrong climb?")
    dd = np.maximum.accumulate(np.clip(d[seg], 0, total))
    dd = (dd - dd[0]) / (dd[-1] - dd[0]) * total  # stretch onto the reference road
    T = np.array([(r["t"] - rows[s]["t"]).total_seconds() for r in rows[seg]])
    return T, dd, rows[seg], on, total


def samples(T, D, rows, total):
    out, last = [], -1
    grid = list(range(0, int(T[-1]), STEP_S)) + [float(T[-1])]
    for g in grid:
        i = int(np.searchsorted(T, g, side="right") - 1)
        if T[i] <= last:
            continue
        lo, hi = max(0, i - 2), min(len(T) - 1, i + 2)
        speed = (D[hi] - D[lo]) / max(T[hi] - T[lo], 1) * 3.6
        out.append(
            {
                "t": int(round(T[i])),
                "d": round(float(D[i]), 2),
                "speed": round(float(speed), 2),
                "watts": rows[i]["w"],
                "hr": rows[i]["hr"],
            }
        )
        last = T[i]
    out[0].update(t=0, d=0.0)
    out[-1]["d"] = total
    return out


def main(args):
    if not args:
        sys.exit(__doc__)
    terrain = json.loads(TERRAIN.read_text())
    riders = []
    for n, arg in enumerate(args):
        name, spec = arg.split("=", 1)
        path, _, colour = spec.partition(":")
        p = Path(path)
        rows = read_fit(p) if p.suffix.lower() == ".fit" else read_gpx(p)
        T, D, seg, on, total = climb(rows, terrain)
        s = samples(T, D, seg, total)
        rid = "".join(
            ch for ch in name.lower().replace(" ", "-") if ch.isalnum() or ch == "-"
        )
        riders.append(
            {
                "id": rid,
                "name": name,
                "color": colour or PALETTE[n % len(PALETTE)],
                "samples": s,
            }
        )
        w = [x["watts"] for x in s if x["watts"] is not None]
        print(
            f"{name}: {int(T[-1]) // 60}:{int(T[-1]) % 60:02d}, {on:.0%} on road, "
            f"avg {round(sum(w) / len(w)) if w else '-'} W, {len(s)} samples",
            file=sys.stderr,
        )
    race = {
        "version": 1,
        "id": "batalla-2026",
        "title": "Coll de sa Batalla",
        "simulated": False,
        "distanceM": float(np.asarray(terrain["route"])[-1, 3]),
        "riders": riders,
    }
    OUT.write_text(json.dumps(race, separators=(",", ":")) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(riders)} riders)", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1:])

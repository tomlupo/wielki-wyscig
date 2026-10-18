# /// script
# requires-python = ">=3.10"
# dependencies = ["fitparse>=1.2", "pyproj>=3.6", "numpy>=1.26"]
# ///
"""Build data/race.json from recorded rides (FIT or GPX), one file per rider.

    uv run scripts/fit_to_race.py "El Lobo=rides/lobo.fit" "Krzysiek=rides/krzys.gpx:#4fc3f7"

    uv run scripts/fit_to_race.py --mass-start "El Lobo=rides/lobo.fit" ...

Each argument is NAME=PATH[:#colour][@MM:SS]. @MM:SS is the rider's official
segment time (e.g. from Strava), and the result: it is kept as `officialTime`
and the rider tops out on it (see Clock). Whole rides are fine: the climb is found automatically by matching GPS
points to the reference road in public/terrain.json (`route`), and cut at the
FIRST arrival at the summit, so a café stop at the top does not count.

Clock. Each rider's start and finish are the moments they cross the reference
road's start and summit, interpolated between GPS points (a watch on smart
recording logs only every ~9 s) and measured EDGE_M inside the road, where the
GPS is clean, then carried to the line at the rider's own speed there.
--mass-start: everyone rode off together, so all riders share one race clock
whose zero is the first rider over the start line; a rider later over the line
waits at d=0 until then. Without it, every rider's own start is their zero (a
time trial).
Official times. Strava's segment starts ~160 m before the reference road, so
each official time is longer than the rider's GPS time on our road by about
the same lead-in (median: 33.7 s on 17.10), written as `clockOffset` and added
to every time the app shows. Each rider tops out at official − lead-in from the
race clock's zero (a mass start counts as one start for everyone, as Strava's
own timing does); the GPS clock is nudged by a few seconds to land there, never
stretched by the whole lead-in. A rider without an official time gets GPS time
+ lead-in, so the finishing order follows the official times.

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
EDGE_M = 60.0  # line crossings are measured this far inside the road, then carried to the line
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
    # Seconds since the Unix epoch: riders on different watches meet on the GPS clock.
    T = np.array(
        [r["t"].replace(tzinfo=dt.timezone.utc).timestamp() for r in rows[seg]]
    )
    return T, dd, rows[seg], on, total


def cross(T, D, target):
    """Interpolated time at which the nondecreasing distance D first reaches target."""
    i = int(np.argmax(D >= target))
    if i == 0:
        return float(T[0])
    return float(
        T[i - 1] + (T[i] - T[i - 1]) * (target - D[i - 1]) / ((D[i] - D[i - 1]) or 1)
    )


def line_times(T, D, total):
    """When the rider crossed the start line and the summit: measured EDGE_M inside, carried out at local speed."""
    a, b = cross(T, D, EDGE_M), cross(T, D, 2 * EDGE_M)
    c, e = cross(T, D, total - 2 * EDGE_M), cross(T, D, total - EDGE_M)
    return a - (b - a), e + (e - c)


def samples(T, D, rows, start, end, total):
    """5-second samples on the race clock (T, start and end are seconds on it): d=0 until the
    rider crosses the start line, the reference distance from the summit on."""

    def at(g):
        if g <= start:
            return 0.0
        if g >= end:
            return total
        return float(min(total, max(0.0, np.interp(g, T, D))))

    out = []
    for g in [*range(0, int(math.ceil(end)), STEP_S), round(end, 1)]:
        if out and g <= out[-1]["t"]:
            continue
        i = max(0, int(np.searchsorted(T, g, side="right")) - 1)
        out.append(
            {
                "t": g,
                "d": round(at(g), 2),
                "speed": round((at(g + 10) - at(g - 10)) / 20 * 3.6, 2),
                "watts": rows[i]["w"],
                "hr": rows[i]["hr"],
            }
        )
    out[-1]["d"] = total
    return out


def seconds(mmss):
    mm, ss = mmss.split(":")
    return int(mm) * 60 + int(ss)


def clock(s):
    s = int(round(s))
    return f"{s // 60}:{s % 60:02d}"


def main(args):
    mass = "--mass-start" in args
    args = [a for a in args if a != "--mass-start"]
    if not args:
        sys.exit(__doc__)
    terrain = json.loads(TERRAIN.read_text())
    parsed = []
    for arg in args:
        name, spec = arg.split("=", 1)
        spec, _, official = spec.partition("@")
        path, _, colour = spec.partition(":")
        p = Path(path)
        rows = read_fit(p) if p.suffix.lower() == ".fit" else read_gpx(p)
        T, D, seg, on, total = climb(rows, terrain)
        start, end = line_times(T, D, total)
        parsed.append((name, colour, official, T, D, seg, on, total, start, end))
    # Official (Strava) times are the result, and the replay shows them exactly. Strava's
    # segment starts ~160 m before the reference road, so every official time is longer than
    # the rider's GPS time on our road by about the same lead-in, measured as the median gap.
    # The race clock stays on our road (it would otherwise open with everyone parked at the
    # start); `clockOffset` = lead-in is what the app adds to every time it shows.
    # Each rider tops out at official − lead-in on the race clock, and their GPS clock is nudged
    # (a few seconds over the climb, never stretched by the whole lead-in) to land there. A rider
    # without an official time gets the same treatment: GPS time + lead-in stands in for it.
    gaps = [seconds(p[2]) - (p[9] - p[8]) for p in parsed if p[2]]
    lead = round(float(np.median(gaps)), 1) if gaps else 0.0
    if gaps:
        print(
            f"Strava lead-in before the reference road: {lead:.1f} s (median of {len(gaps)})",
            file=sys.stderr,
        )
    if mass:
        spread = max(p[8] for p in parsed) - min(p[8] for p in parsed)
        if spread > 60:
            raise SystemExit(
                f"--mass-start, but riders crossed the start line {spread:.0f} s apart"
            )
        gun = min(p[8] for p in parsed)
    for k, (name, colour, official, T, D, seg, on, total, start, end) in enumerate(
        parsed
    ):
        result = seconds(official) if official else round(end - start + lead)
        target = (gun if mass else start) + result - lead
        print(
            f"  {name:12} {'official' if official else 'estimated'} {clock(result)}, clock nudged {target - end:+.1f} s",
            file=sys.stderr,
        )
        T = start + (T - start) * (target - start) / (end - start)
        parsed[k] = (name, colour, official, T, D, seg, on, total, start, target)
    riders = []
    for n, (name, colour, official, T, D, seg, on, total, start, end) in enumerate(
        parsed
    ):
        zero = gun if mass else start
        s = samples(T - zero, D, seg, start - zero, end - zero, total)
        rid = "".join(
            ch for ch in name.lower().replace(" ", "-") if ch.isalnum() or ch == "-"
        )
        rider = {"id": rid, "name": name, "color": colour or PALETTE[n % len(PALETTE)]}
        if official:
            rider["officialTime"] = seconds(official)
        riders.append({**rider, "samples": s})
        w = [x["watts"] for x in s if x["watts"] is not None]
        print(
            f"{name:12} over the line +{start - zero:4.1f} s, top at {clock(end - zero + lead)} on the Strava clock "
            f"(own time {clock(end - start)}{', official ' + official if official else ''}), "
            f"{on:.0%} on road, avg {round(sum(w) / len(w)) if w else '-'} W, {len(s)} samples",
            file=sys.stderr,
        )
    race = {
        "version": 1,
        "id": "batalla-2026",
        "title": "Coll de sa Batalla",
        "simulated": False,
        "distanceM": float(np.asarray(terrain["route"])[-1, 3]),
        "clockOffset": round(lead, 1),
        "riders": riders,
    }
    OUT.write_text(json.dumps(race, separators=(",", ":")) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(riders)} riders)", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1:])

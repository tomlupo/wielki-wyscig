# /// script
# requires-python = ">=3.10"
# dependencies = ["pyproj>=3.6", "numpy>=1.26"]
# ///
"""Put the phone clips on the race clock.

    uv run scripts/reel/sync.py [--videos data/videos] [--out out/reel/sync.json]

race.json has no wall clock: `t` counts from each rider's entry into the segment.
The clips have one (QuickTime creation_time, UTC) and a GPS fix
(com.apple.quicktime.location.ISO6709). This script:

1. projects each fix onto the reference road with the same projection and
   map-matching as scripts/fit_to_race.py (imported, not copied): road distance
   `d` and the fix's offset from the road;
2. fits ONE absolute start time S for the race (everyone rolled out of Caimari
   together, so race time t = wall time - S for every rider). A clip filmed at
   road point d at wall time T is explained by rider r if T ≈ S + t_r(d). S is
   the value that explains the most clips (a robust vote, not a mean), then
   refined on the clips that agree with it;
3. labels every clip: `riding` (the camera moves with the riders, its time fits
   S within tolerance), `waiting` (the camera reached d BEFORE the riders it
   films, e.g. stopped at the roadside: T is earlier than the first arrival),
   `summit` (filmed at the top after the leaders finished), or `off-route`
   (not on the climb: the morning roll-out, a café selfie).

For each clip it writes the race time at the clip's first frame, `raceT0`, so the
reel can show live data over it and fly the 3D camera to exactly `d`.
"""

from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import re
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location(
    "fit_to_race", ROOT / "scripts" / "fit_to_race.py"
)
ftr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ftr)

NEAR_M = 60.0  # a fix closer than this to the road is "on the climb" (phone GPS at the start of a recording is coarse)
TOL_S = 45.0  # a clip agrees with S if some rider passed its road point within this many seconds of its timestamp


def probe(path: Path) -> dict:
    j = json.loads(
        subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                str(path),
            ]
        )
    )
    v = next(s for s in j["streams"] if s["codec_type"] == "video")
    a = next((s for s in j["streams"] if s["codec_type"] == "audio"), None)
    tags = j["format"].get("tags", {})
    rot = next(
        (sd.get("rotation") for sd in v.get("side_data_list", []) if "rotation" in sd),
        None,
    )
    rot = int(rot if rot is not None else v.get("tags", {}).get("rotate", 0))
    w, h = int(v["width"]), int(v["height"])
    if rot % 180:
        w, h = h, w
    num, den = (int(x) for x in v["r_frame_rate"].split("/"))
    loc = None
    m = re.match(
        r"([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?",
        tags.get("com.apple.quicktime.location.ISO6709", ""),
    )
    if m:
        loc = {
            "lat": float(m.group(1)),
            "lon": float(m.group(2)),
            "alt": float(m.group(3)) if m.group(3) else None,
        }
    created = tags.get("creation_time")
    local = tags.get(
        "com.apple.quicktime.creationdate"
    )  # e.g. 2026-10-17T12:04:29+0200
    return {
        "file": path.name,
        "duration": float(j["format"]["duration"]),
        "width": w,
        "height": h,
        "rotation": rot,
        "fps": num / den,
        "hdr": v.get("color_transfer") in ("arib-std-b67", "smpte2084"),
        "audio": a is not None,
        "created": created,
        "utcOffset": local[-5:] if local else None,
        "epoch": dt.datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp()
        if created
        else None,
        "gps": loc,
    }


def along_route_3d(
    p: np.ndarray, alt: float, route: np.ndarray
) -> tuple[float, float, float]:
    """fit_to_race.along_route for one fix, choosing among the road legs within NEAR_M by plan offset
    plus height mismatch (phone GPS height is good to ~10 m): road distance, offset, road altitude."""
    A, B = route[:-1, :2], route[1:, :2]
    AB = B - A
    t = np.clip(((p - A) * AB).sum(1) / (AB**2).sum(1), 0, 1)
    off = np.sqrt(((p - (A + t[:, None] * AB)) ** 2).sum(1))
    d = route[:-1, 3] + t * (route[1:, 3] - route[:-1, 3])
    a = route[:-1, 2] + t * (route[1:, 2] - route[:-1, 2])
    cost = np.where(off < NEAR_M, off + np.abs(alt - a), np.inf)
    k = int(np.argmin(cost))
    return float(d[k]), float(off[k]), float(a[k])


PASS_M = 40.0  # a rider whose track comes this close to the camera's GPS fix passes the camera


def fit_passes(c: dict, tracks: dict, cam: np.ndarray) -> list[dict]:
    """Riders whose FIT track passes within PASS_M of the camera during the clip (±5 s): when, how close.
    The camera's fix is taken as the recording starts and can be a few seconds stale, so `at` is
    approximate; the editor's sightings (clips.json) give the exact second."""
    out = []
    for rid, tr in tracks.items():
        t = tr["t0"] + np.arange(len(tr["x"]))
        win = (t >= c["epoch"] - 5) & (t <= c["epoch"] + c["duration"] + 5)
        if not win.any():
            continue
        dist = np.hypot(
            np.asarray(tr["x"])[win] - cam[0], np.asarray(tr["z"])[win] - cam[1]
        )
        k = int(np.argmin(dist))
        if dist[k] < PASS_M:
            out.append(
                {
                    "rider": rid,
                    "at": round(float(t[win][k] - c["epoch"]), 1),
                    "dist": round(float(dist[k]), 1),
                }
            )
    return sorted(out, key=lambda p: p["at"])


def time_at_distance(samples: list[dict], d: float) -> float:
    """First arrival at road distance d (as src/race.js timeAtDistance)."""
    if d <= samples[0]["d"]:
        return samples[0]["t"]
    if d >= samples[-1]["d"]:
        return samples[-1]["t"]
    lo, hi = 0, len(samples) - 1
    while hi - lo > 1:
        mid = (lo + hi) >> 1
        if samples[mid]["d"] < d:
            lo = mid
        else:
            hi = mid
    a, b = samples[lo], samples[hi]
    return (
        a["t"]
        if b["d"] == a["d"]
        else a["t"] + (b["t"] - a["t"]) * (d - a["d"]) / (b["d"] - a["d"])
    )


def clock(epoch: float, offset: str | None) -> str:
    tz = dt.timezone.utc
    if offset:
        sign = 1 if offset[0] == "+" else -1
        tz = dt.timezone(
            sign * dt.timedelta(hours=int(offset[1:3]), minutes=int(offset[3:5]))
        )
    return dt.datetime.fromtimestamp(epoch, tz).strftime("%H:%M:%S")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--videos", default=str(ROOT / "data" / "videos"))
    ap.add_argument("--out", default=str(ROOT / "out" / "reel" / "sync.json"))
    ap.add_argument("--clips", default=str(ROOT / "scripts" / "reel" / "clips.json"))
    ap.add_argument("--tracks", default=str(ROOT / "out" / "reel" / "tracks.json"))
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    terrain = json.loads((ROOT / "public" / "terrain.json").read_text())
    race = json.loads((ROOT / "data" / "race.json").read_text())
    route = np.asarray(terrain["route"], float)
    total = float(route[-1, 3])
    riders = race["riders"]
    finish = [r["samples"][-1]["t"] for r in riders]

    clips = [
        probe(p)
        for p in sorted(Path(args.videos).iterdir())
        if p.suffix.lower() in (".mov", ".mp4")
    ]
    for c in clips:
        c["d"] = c["offRoad"] = c["altDelta"] = None
        if c["gps"]:
            P = ftr.project([c["gps"]], terrain)
            d, off = ftr.along_route(P, route)
            c["d"], c["offRoad"] = round(float(d[0]), 1), round(float(off[0]), 1)
            if c["gps"]["alt"] is not None and off[0] < NEAR_M:
                # The check on the projection: the fix's own altitude against the road's at d. On a stack of
                # hairpins the nearest leg in plan can be the wrong one; the leg that also fits the height wins.
                d2, off2, alt2 = along_route_3d(P[0], c["gps"]["alt"], route)
                c["d"], c["offRoad"] = round(d2, 1), round(off2, 1)
                c["altDelta"] = round(c["gps"]["alt"] - alt2, 1)
        c["onClimb"] = (
            c["d"] is not None and c["offRoad"] < NEAR_M and c["epoch"] is not None
        )

    # Candidate starts: every (clip, rider) pair proposes S = T - t_r(d). Score each candidate by how many
    # clips it explains (some rider within TOL_S of the clip time; a clip at the summit is explained when
    # it comes after the first finisher). The best-supported S wins; ties go to the smaller total residual.
    on = [c for c in clips if c["onClimb"]]
    arrivals = {
        c["file"]: np.array([time_at_distance(r["samples"], c["d"]) for r in riders])
        for c in on
    }

    def residuals(S: float) -> dict[str, float]:
        out = {}
        for c in on:
            rt = c["epoch"] - S  # race time at the clip's first frame
            out[c["file"]] = float(np.min(np.abs(arrivals[c["file"]] - rt)))
        return out

    cands = sorted({c["epoch"] - t for c in on for t in arrivals[c["file"]]})
    best = None
    for S in cands:
        res = residuals(S)
        n = sum(v <= TOL_S for v in res.values())
        cost = sum(min(v, TOL_S) for v in res.values())
        if best is None or (n, -cost) > (best[1], -best[2]):
            best = (S, n, cost)
    S0 = best[0]
    # Refine: least-squares over the agreeing clips, each matched to its nearest rider.
    agree = [c for c in on if residuals(S0)[c["file"]] <= TOL_S]
    for _ in range(5):
        shifts = []
        for c in agree:
            rt = c["epoch"] - S0
            k = int(np.argmin(np.abs(arrivals[c["file"]] - rt)))
            shifts.append(rt - arrivals[c["file"]][k])
        S0 += float(np.median(shifts))
    S_auto = S0
    offset = next((c["utcOffset"] for c in clips if c["utcOffset"]), None)

    # Sightings from the editor's log (clips.json): rider r passes the camera at clip second `at`.
    # Each one dates the start directly, S = T + at - t_r(d); the median of them wins over the vote,
    # and a clip with its own sightings keeps its own offset, so the data on screen matches the rider in it.
    log = json.loads(Path(args.clips).read_text()) if Path(args.clips).exists() else {}
    ids = [r["id"] for r in riders]
    seen = []
    for c in on:
        for s in log.get(c["file"], {}).get("sightings", []):
            t_r = time_at_distance(riders[ids.index(s["rider"])]["samples"], c["d"])
            seen.append(
                {
                    "file": c["file"],
                    "rider": s["rider"],
                    "at": s["at"],
                    "start": c["epoch"] + s["at"] - t_r,
                    "t": t_r,
                }
            )
    S = float(np.median([s["start"] for s in seen])) if seen else S_auto

    # With the riders' own FIT rides (tracks.py → tracks.json) the clock needs no inference: rider r's
    # race.json time at wall time T is (T - climb start_r) x stretch_r, and their 1 Hz track shows who
    # passed each camera. Then the vote and the sightings above are only the cross-check.
    tracks = (
        json.loads(Path(args.tracks).read_text())["riders"]
        if Path(args.tracks).exists()
        else None
    )

    def race_t(rid: str, T: float) -> float:
        return (T - tracks[rid]["climbStart"]) * tracks[rid]["stretch"]

    for c in clips:
        c["raceT0"] = None if c["epoch"] is None else round(c["epoch"] - S, 2)
        if tracks and c["epoch"] is not None:
            c["raceT0"] = round(
                float(np.median([race_t(rid, c["epoch"]) for rid in tracks])), 2
            )
            if c["gps"] and c["offRoad"] is not None and c["offRoad"] < 500:
                c["fitPasses"] = fit_passes(
                    c, tracks, ftr.project([c["gps"]], terrain)[0]
                )
        mine = [s for s in seen if s["file"] == c["file"]]
        if mine:  # this clip's own clock: the identified riders pass when the race data says they do
            if tracks:
                for s in mine:
                    s["t"] = race_t(s["rider"], c["epoch"] + s["at"])
            c["raceT0"] = round(float(np.median([s["t"] - s["at"] for s in mine])), 2)
            c["sightings"] = [
                {k: s[k] for k in ("rider", "at")}
                | {"offsetFromStart": round(s["start"] - S, 1)}
                | (
                    {
                        "fit": any(
                            p["rider"] == s["rider"] for p in c.get("fitPasses", [])
                        )
                    }
                    if tracks
                    else {}
                )
                for s in mine
            ]
        if not c["onClimb"]:
            c["kind"] = "off-route"
            continue
        rt = c["raceT0"]
        arr = arrivals[c["file"]]
        k = int(np.argmin(np.abs(arr - rt)))
        c["nearest"] = {
            "rider": riders[k]["id"],
            "arrival": round(float(arr[k]), 1),
            "residual": round(float(rt - arr[k]), 1),
        }
        c["arrivals"] = {r["id"]: round(float(a), 1) for r, a in zip(riders, arr)}
        if c["d"] >= total - 120 and rt > min(finish):
            c["kind"] = "summit"
        elif abs(rt - arr[k]) <= TOL_S:
            c["kind"] = "riding"
        elif rt < arr.min():
            c["kind"] = "waiting"
        else:
            c["kind"] = "outlier"

    spread = [s["start"] - S for s in seen]
    out = {
        "start": {
            "epoch": round(S, 2),
            "local": clock(S, offset),
            "utcOffset": offset,
            "auto": {
                "epoch": round(S_auto, 2),
                "local": clock(S_auto, offset),
                "support": f"{len(agree)}/{len(on)} climb clips within {TOL_S:.0f} s",
            },
            "sightings": len(seen),
            "spread": [round(min(spread), 1), round(max(spread), 1)] if seen else None,
        },
        "clips": clips,
    }
    if tracks:
        starts = [tr["climbStart"] for tr in tracks.values()]
        mid = float(np.median(starts))
        out["start"]["fit"] = {
            "local": clock(mid, offset),
            "epoch": round(mid, 1),
            "spread": [
                round(float(min(starts) - mid), 1),
                round(float(max(starts) - mid), 1),
            ],
            "stretch": round(
                float(np.median([tr["stretch"] for tr in tracks.values()])), 4
            ),
        }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, indent=1))

    if tracks:
        f = out["start"]["fit"]
        print(
            f"clock from the FIT rides: climb starts {f['local']} ({f['spread']} s), race.json clocks run x{f['stretch']} (official times)"
        )
    print(
        f"race start {out['start']['local']} from {len(seen)} sightings (spread {out['start']['spread']} s); "
        f"vote without them: {out['start']['auto']['local']} ({out['start']['auto']['support']})"
    )
    for c in clips:
        where = (
            f"d={c['d']:7.1f} m off={c['offRoad']:6.1f} m"
            if c["d"] is not None
            else "no GPS".ljust(26)
        )
        when = clock(c["epoch"], c["utcOffset"] or offset) if c["epoch"] else "--:--:--"
        extra = ""
        if c.get("nearest"):
            n = c["nearest"]
            extra = f"race t={c['raceT0']:7.1f}  nearest {n['rider']:<12} {n['residual']:+6.1f} s"
        print(f"{c['file']:<13} {when} {where} {c['kind']:<9} {extra}")
        if c.get("fitPasses"):
            print(
                "    passes the camera (FIT): "
                + ", ".join(
                    f"{p['rider']} {p['at']:+.0f}s/{p['dist']:.0f}m"
                    for p in c["fitPasses"]
                )
            )
        if args.verbose and c.get("arrivals"):
            print(
                "    "
                + "  ".join(
                    f"{k}:{v - c['raceT0']:+.0f}" for k, v in c["arrivals"].items()
                )
            )


if __name__ == "__main__":
    main()

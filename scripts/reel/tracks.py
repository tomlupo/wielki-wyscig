# /// script
# requires-python = ">=3.10"
# dependencies = ["fitparse>=1.2", "pyproj>=3.6", "numpy>=1.26"]
# ///
"""Every rider's ride on the wall clock, from the raw FIT files (rides/<rider id>.fit).

    uv run scripts/reel/tracks.py [--rides rides] [--out out/reel/tracks.json]

race.json keeps only the climb, on each rider's own clock (t from their start, stretched
to the official segment time). The FIT files keep the wall clock, so here each rider gets:
the UTC second they started the climb (the same cut as scripts/fit_to_race.py, imported),
the stretch from GPS seconds to race.json seconds, and a 1 Hz track around the climb:
position in the terrain frame, road distance, heart rate, power. The clip sync reads it to
see exactly who passed each camera, and when.
"""

from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location(
    "fit_to_race", ROOT / "scripts" / "fit_to_race.py"
)
ftr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ftr)

PAD_S = 15 * 60  # track kept from this long before the climb to this long after it


def utc(t: dt.datetime) -> float:
    """FIT timestamps are UTC (fitparse returns them naive)."""
    return (t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)).timestamp()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rides", default=str(ROOT / "rides"))
    ap.add_argument("--out", default=str(ROOT / "out" / "reel" / "tracks.json"))
    args = ap.parse_args()

    terrain = json.loads((ROOT / "public" / "terrain.json").read_text())
    race = json.loads((ROOT / "data" / "race.json").read_text())
    route = np.asarray(terrain["route"], float)
    out = {"riders": {}}
    for r in race["riders"]:
        path = Path(args.rides) / f"{r['id']}.fit"
        if not path.exists():
            print(f"{r['id']}: no {path.name}")
            continue
        rows = ftr.read_fit(path)
        T, D, seg, on, total = ftr.climb(rows, terrain)  # T: epoch seconds
        start, end = ftr.line_times(
            T, D, total
        )  # start-line and summit crossings, epoch seconds
        ep = np.array([utc(x["t"]) for x in rows])
        sel = [x for x, e in zip(rows, ep) if start - PAD_S <= e <= end + PAD_S]
        e = np.array([utc(x["t"]) for x in sel])
        P = ftr.project(sel, terrain)
        d, off = ftr.along_route(P, route)
        grid = np.arange(
            np.ceil(e[0]), np.floor(e[-1]) + 1
        )  # 1 Hz on the wall clock (smart recording skips seconds)

        def resample(values: list) -> list:
            v = np.array([np.nan if x is None else x for x in values], float)
            ok = ~np.isnan(v)
            if ok.sum() < 2:
                return [None] * len(grid)
            return [round(float(x), 1) for x in np.interp(grid, e[ok], v[ok])]

        import fitparse  # the whole day's totals, from the FIT session summary

        sess = next(
            (
                m.get_values()
                for m in fitparse.FitFile(str(path)).get_messages("session")
            ),
            {},
        )
        day = {
            k: sess.get(f)
            for k, f in (
                ("km", "total_distance"),
                ("ascent", "total_ascent"),
                ("hours", "total_elapsed_time"),
                ("avgHr", "avg_heart_rate"),
                ("avgW", "avg_power"),
            )
        }
        day["km"] = round(day["km"] / 1000, 1) if day["km"] else None
        day["hours"] = round(day["hours"] / 3600, 2) if day["hours"] else None
        out["riders"][r["id"]] = {
            "name": r["name"],
            "day": day,
            "lineStart": round(start, 2),  # over the start line (epoch s)
            "lineEnd": round(end, 2),  # over the top (epoch s)
            "official": r.get("officialTime"),
            "onRoad": round(float(on), 3),
            "t0": float(grid[0]),
            "x": resample(P[:, 0]),
            "z": resample(P[:, 1]),
            "d": resample(d),
            "off": resample(off),
            "hr": resample([x["hr"] for x in sel]),
            "w": resample([x["w"] for x in sel]),
        }
        local = dt.datetime.fromtimestamp(start, dt.timezone(dt.timedelta(hours=2)))
        print(
            f"{r['id']:<12} over the start line {local:%H:%M:%S} (+02:00), own time {end - start:.0f} s, {len(grid)} s of track"
        )
    # The race clock, as scripts/fit_to_race.py --mass-start builds race.json: t=0 is the first rider over
    # the start line (the gun); each rider tops out at official − clockOffset, their GPS clock nudged
    # linearly from their own start-line crossing to land there. So a wall-clock second W is race time
    # lineStart + (W − lineStart)·k − gun for that rider (k within a few tenths of a percent of 1).
    if out["riders"]:
        lead = float(race.get("clockOffset") or 0)
        gun = min(v["lineStart"] for v in out["riders"].values())
        for v in out["riders"].values():
            result = (
                v["official"]
                if v["official"]
                else round(v["lineEnd"] - v["lineStart"] + lead)
            )
            target = gun + result - lead
            v["k"] = round(
                (target - v["lineStart"]) / (v["lineEnd"] - v["lineStart"]), 6
            )
        out["gun"], out["clockOffset"] = round(gun, 2), lead
        spread = max(v["lineStart"] for v in out["riders"].values()) - gun
        print(
            f"race clock: gun {dt.datetime.fromtimestamp(gun, dt.timezone(dt.timedelta(hours=2))):%H:%M:%S}, last rider over the line {spread:.1f} s later, shown times + {lead} s"
        )
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, separators=(",", ":")))


if __name__ == "__main__":
    main()

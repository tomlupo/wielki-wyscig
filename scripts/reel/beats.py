# /// script
# requires-python = ">=3.10"
# dependencies = ["librosa>=0.10", "numpy>=1.26", "soundfile>=0.12"]
# ///
"""Beat-map the reel's music track.

    uv run scripts/reel/beats.py data/music/track.mp3 [--out out/reel/beats.json] [--start 0]

Writes the tempo, every beat, the bar starts (downbeats), a 10 Hz loudness curve and the
"hits": bar starts where the track jumps in energy (a drop, a new section), strongest
first. The planner snaps cuts to beats, act changes to bars, and big moments to hits.

Downbeats: librosa tracks beats but not bars, so the bar phase (which beat of four is
the "one") is the phase whose beats carry the most low-frequency onset energy.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import librosa
import numpy as np

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("track")
    ap.add_argument("--out", default=str(ROOT / "out" / "reel" / "beats.json"))
    ap.add_argument(
        "--start",
        type=float,
        default=None,
        help="music time of reel frame 0 (default: the first beat)",
    )
    args = ap.parse_args()

    y, sr = librosa.load(args.track, sr=22050, mono=True)
    dur = len(y) / sr
    hop = 512
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    tempo, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset, sr=sr, hop_length=hop, units="frames"
    )
    tempo = float(np.atleast_1d(tempo)[0])
    beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)

    # bar phase from the bass: onset strength below ~150 Hz at each beat
    S = np.abs(librosa.stft(y, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr)
    low = librosa.onset.onset_strength(
        S=librosa.amplitude_to_db(S[freqs < 150]), sr=sr, hop_length=hop
    )
    at = np.clip(beat_frames, 0, len(low) - 1)
    phase = int(
        np.argmax([low[at[k::4]].mean() if len(at[k::4]) else 0 for k in range(4)])
    )
    downbeats = beats[phase::4]

    # loudness, 10 Hz, and the bar starts where it jumps
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    t_rms = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
    grid = np.arange(0, dur, 0.1)
    energy = np.interp(grid, t_rms, rms)
    energy = energy / (energy.max() or 1)

    def mean_between(a: float, b: float) -> float:
        m = (grid >= a) & (grid < b)
        return float(energy[m].mean()) if m.any() else 0.0

    bar = 4 * 60 / tempo
    hits = sorted(
        (
            {
                "t": round(float(d), 3),
                "jump": round(mean_between(d, d + bar) - mean_between(d - bar, d), 4),
            }
            for d in downbeats[1:]
        ),
        key=lambda h: -h["jump"],
    )
    hits = [h for h in hits if h["jump"] > 0.05][:12]

    start = (
        args.start if args.start is not None else float(beats[0]) if len(beats) else 0.0
    )
    out = {
        "file": Path(args.track).name,
        "duration": round(dur, 3),
        "tempo": round(tempo, 2),
        "start": round(start, 3),
        "beats": [round(float(b), 3) for b in beats],
        "downbeats": [round(float(b), 3) for b in downbeats],
        "hits": hits,
        "energy": [round(float(e), 3) for e in energy],
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out))
    print(
        f"{out['file']}: {dur:.1f} s, {tempo:.1f} BPM, {len(beats)} beats, {len(downbeats)} bars (phase {phase}), "
        f"hits at {', '.join(f'{h['t']:.1f}' for h in sorted(hits[:6], key=lambda h: h['t']))} s"
    )


if __name__ == "__main__":
    main()

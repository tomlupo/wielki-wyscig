// The auto "TV" camera: picks shots by itself, like a race broadcast.
//
// A few seconds of playback before a race event (or a video moment) it cuts to
// the rider who makes the move, holds through it, then goes back to the leader
// or a wide view. With nothing coming it varies the picture now and then.
// Cuts are paced on the wall clock (`now`, seconds), never faster than
// `minCut`, so the picture stays calm at every replay speed.
//
// update() returns a cut { shot, rider, side, caption } or null (hold).
// shot ∈ follow | side | heli | drone | track | lens | overview (see world.setShot).
// With nothing coming it mixes in slow wide establishing shots: a drone orbit,
// a high tracking shot along the road, a long lens from the road ahead.
//
// slowmo(time, speed) → a playback rate factor in (0, 1]: around the big moments
// (the finish, the first over the summit, a lead change) the replay eases into
// slow motion and back out. Big moments closer than SLOW_GAP race seconds to an
// earlier one play at normal speed, so slow motion stays occasional.

const SHOT_FOR = { lead: ['side', 'lens', 'follow'], pass: ['side', 'drone', 'follow'], summit: ['lens', 'follow'], finish: ['lens', 'side'], media: ['follow'] };
const IDLE = ['drone', 'heli', 'lens', 'chase', 'track', 'overview', 'follow'];
const SLOW_MIN = 0.35, SLOW_GAP = 240;

export function createDirector({ targets, order, names, minCut = 6, lead = 3, hold = 4, idle = 16 }) {
  const slowAt = [];
  for (const e of targets) {
    if (!['finish', 'summit', 'lead'].includes(e.type) || e.score < 70) continue;
    if (e.type !== 'finish' && slowAt.length && e.t - slowAt.at(-1) < SLOW_GAP) continue;
    slowAt.push(e.t);
  }
  // targets: [{ t, type, rider, score }] sorted by t; order(t) → rider indices by race position.
  let lastCut = -Infinity, lastTime = 0, holdUntil = -Infinity, back = false, count = 0, idleStep = 0;
  const done = new Set();

  function cut(now, shot, rider, caption) {
    lastCut = now;
    count++;
    return { shot, rider, side: count % 2 ? 1 : -1, caption };
  }
  const leaderCut = (now, time, shot = 'follow') => {
    const top = order(time)[0];
    return cut(now, shot, top, `${names[top]} · Leader`);
  };

  return {
    // Full slow motion within half a second of playback of the moment, easing back to normal over the next half second.
    slowmo(time, speed) {
      const w = Math.max(2, 0.5 * speed);
      let f = 1;
      for (const t of slowAt) {
        const x = Math.min(1, Math.max(0, (Math.abs(t - time) - w) / w));
        f = Math.min(f, SLOW_MIN + (1 - SLOW_MIN) * x * x * (3 - 2 * x));
      }
      return f;
    },
    // Start (or restart after a seek): the leader, at once.
    start(time, now) {
      idleStep = 0;
      done.clear();
      targets.forEach((e, k) => { if (e.t <= time) done.add(k); });
      lastTime = time; holdUntil = -Infinity; back = false;
      return leaderCut(now, time);
    },
    update({ time, speed, now }) {
      if (time < lastTime - 1 || time > lastTime + speed * 2 + 5) return this.start(time, now); // the viewer jumped
      lastTime = time;
      if (now - lastCut < minCut) return null;
      // Something happens within the next `lead` seconds of playback: go to the rider who makes it.
      const window = Math.max(2, lead * speed);
      let next = -1;
      targets.forEach((e, k) => {
        if (done.has(k) || e.t <= time || e.t > time + window) return;
        if (next < 0 || e.score > targets[next].score) next = k;
      });
      for (const [k, e] of targets.entries()) if (e.t <= time) done.add(k); // a move missed during a hold is gone
      if (next >= 0) {
        const e = targets[next], shots = SHOT_FOR[e.type] ?? ['follow'];
        done.add(next);
        holdUntil = e.t + Math.max(2, hold * speed);
        back = true;
        return cut(now, shots[count % shots.length], e.rider, null);
      }
      if (time < holdUntil) return null;
      if (back) { // the move is over: back to the head of the race
        back = false;
        return count % 3 === 2 ? cut(now, 'drone', order(time)[0], null) : leaderCut(now, time);
      }
      if (now - lastCut < idle) return null;
      const kind = IDLE[idleStep++ % IDLE.length], ranks = order(time);
      if (kind === 'chase' && ranks.length > 1) return cut(now, 'follow', ranks[1], `${names[ranks[1]]} · P2`);
      if (kind === 'overview') return cut(now, 'overview', ranks[0], null);
      return leaderCut(now, time, kind === 'chase' ? 'follow' : kind);
    },
  };
}

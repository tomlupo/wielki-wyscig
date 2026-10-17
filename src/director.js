// The auto "TV" camera: picks shots by itself, like a race broadcast.
//
// A few seconds of playback before a race event (or a video moment) it cuts to
// the rider who makes the move, holds through it, then goes back to the leader
// or a wide view. With nothing coming it varies the picture now and then.
// Cuts are paced on the wall clock (`now`, seconds), never faster than
// `minCut`, so the picture stays calm at every replay speed.
//
// update() returns a cut { shot, rider, side, caption } or null (hold).
// shot ∈ follow | side | pov | heli | overview (see world.setShot).

const SHOT_FOR = { lead: ['side', 'follow'], pass: ['side', 'pov', 'follow'], summit: ['follow', 'side'], finish: ['side'], media: ['follow'] };
const IDLE = ['heli', 'chase', 'side', 'overview', 'follow'];

export function createDirector({ targets, order, names, minCut = 6, lead = 3, hold = 4, idle = 16 }) {
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
    // Start (or restart after a seek): the leader, at once.
    start(time, now) {
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
        return count % 3 === 2 ? cut(now, 'overview', order(time)[0], null) : leaderCut(now, time);
      }
      if (now - lastCut < idle) return null;
      const kind = IDLE[idleStep++ % IDLE.length], ranks = order(time);
      if (kind === 'chase' && ranks.length > 1) return cut(now, 'follow', ranks[1], `${names[ranks[1]]} · P2`);
      if (kind === 'overview') return cut(now, 'overview', ranks[0], null);
      return leaderCut(now, time, kind === 'chase' ? 'follow' : kind);
    },
  };
}

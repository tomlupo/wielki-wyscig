// The auto "TV" camera: picks shots by itself, like a race broadcast.
//
// A few seconds of playback before a race event (or a video moment) it cuts to
// the rider who makes the move, holds through it, then goes back to the leader
// or a wide view. With nothing coming it varies the picture now and then.
// Cuts are paced on the wall clock (`now`, seconds), never faster than
// `minCut`, so the picture stays calm at every replay speed.
//
// update() returns a cut { shot, rider, side, caption } or null (hold).
// shot ∈ follow | side | pov | heli | drone | high | ahead | overview (see world.setShot).
// timeScale() eases playback down to slow motion around the big moments.

const SHOT_FOR = { lead: ['side', 'ahead', 'follow'], pass: ['side', 'drone', 'follow'], summit: ['ahead', 'side'], finish: ['ahead', 'side'], media: ['follow'] };
// With nothing coming, slow wide establishing shots: the group from a drone, the helicopter, a high tracking shot, a long lens from up the road.
const IDLE = ['drone', 'heli', 'chase', 'high', 'ahead', 'overview', 'follow'];
const SLOWMO_SCORE = 50, SLOWMO_REACH = 2.5, SLOWMO_MIN = 0.35; // events that slow time; wall seconds either side; slowest rate
const CAPTION_WALL = 3.5; // wall seconds a lower third stays up (main.js shows it 3.2 s)

export function createDirector({ targets, order, names, minCut = 6, lead = 3, hold = 4, idle = 16 }) {
  // targets: [{ t, type, rider, score }] sorted by t; order(t) → rider indices by race position.
  let lastCut = -Infinity, lastTime = 0, lastSpeed = 1, holdUntil = -Infinity, back = false, count = 0, idleStep = 0;
  const done = new Set();

  function cut(now, shot, rider, caption) {
    lastCut = now;
    count++;
    return { shot, rider, side: count % 2 ? 1 : -1, caption };
  }
  // A rank is named on screen only if it holds while the caption is up: in a tight
  // group the order flips every few seconds, and "Leader" over the rider in P2 reads as a bug.
  const holds = (time, rank, who) => {
    for (let s = 0, end = CAPTION_WALL * lastSpeed; s <= end; s += Math.max(0.5, end / 40)) if (order(time + s)[rank] !== who) return false;
    return order(time + CAPTION_WALL * lastSpeed)[rank] === who;
  };
  const rankCut = (now, time, shot, rank, label) => {
    const who = order(time)[rank];
    return cut(now, shot, who, holds(time, rank, who) ? `${names[who]} · ${label}` : null);
  };
  const leaderCut = (now, time, shot = 'follow') => rankCut(now, time, shot, 0, 'Leader');

  return {
    // Start (or restart after a seek): the leader, at once.
    start(time, now, speed = lastSpeed) {
      lastSpeed = speed;
      done.clear();
      targets.forEach((e, k) => { if (e.t <= time) done.add(k); });
      lastTime = time; holdUntil = -Infinity; back = false;
      return leaderCut(now, time);
    },
    update({ time, speed, now }) {
      if (time < lastTime - 1 || time > lastTime + speed * 2 + 5) return this.start(time, now, speed); // the viewer jumped
      lastTime = time; lastSpeed = speed;
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
      if (kind === 'chase' && ranks.length > 1) return rankCut(now, time, 'follow', 1, 'P2');
      if (kind === 'overview') return cut(now, 'overview', ranks[0], null);
      return leaderCut(now, time, kind === 'chase' ? 'follow' : kind);
    },
    // Playback rate factor in (0, 1]: 1 away from big moments, easing to SLOWMO_MIN at one.
    timeScale(time, speed) {
      let s = 1;
      for (const e of targets) {
        if (e.score < SLOWMO_SCORE) continue;
        const wall = Math.abs(e.t - time) / speed;
        if (wall >= SLOWMO_REACH) continue;
        const u = wall / SLOWMO_REACH;
        s = Math.min(s, SLOWMO_MIN + (1 - SLOWMO_MIN) * u * u * (3 - 2 * u));
      }
      return s;
    },
  };
}

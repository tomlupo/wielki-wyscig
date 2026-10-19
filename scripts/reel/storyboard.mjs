// The edit: the race told in acts, mostly on the riders' own phone footage with their data on it
// (power, heart rate, gaps, places), the 3D replay for what no phone caught: the title, the first
// moves, the attack and the answer to it, the win, and the last 400 m, which it takes over from the
// last clip in a match cut. Segments carry nominal durations (the planner snaps every cut to the
// music, a match cut excepted) and the graphics that ride on them.
//
// Race moments come from the data (deriveEvents, the riders' samples), clip moments from the
// editor's log and the FIT-synced clock (sync.json). Nothing is a hard-coded race time: change
// race.json and the attack, the winner and every number follow.
//
// Segment: { id, kind: '3d' | 'clip', dur, enter?: { type, frames }, snap?: 'bar' | 'beat' | 'hit' | false, ... }
//   3d:   cam (src/reel/camera.js spec), time: { t, at = 0, speed (number | [[sec, speed]]) }, focus, labels
//   clip: file, src: { s, at = 0, speed }, zoom, audio, fit16 ('data' | 'blur' for the 16:9 layout)
//   cues: [{ type, at, dur | 'end', ...props }] relative to the segment start
// Spans: [{ type, from: segId, to: segId, skip }] graphics that stay up across several segments.
import { interpolate } from '../../src/race.js';

export function storyboard({ model, sync, fmt, credits = {} }) {
  const { riders, events, len, duration } = model;
  const portrait = fmt === '9x16';
  const R = id => { const i = riders.findIndex(r => r.id === id); if (i < 0) throw new Error(`no rider ${id}`); return i; };
  const name = i => riders[i].name;
  const clipInfo = f => { const c = sync.clips.find(x => x.file === f); if (!c) throw new Error(`no clip ${f}`); return c; };
  // Times on screen are on the official clock (race time + clockOffset); a finish without an official time is an estimate.
  const clock = s => { const v = Math.floor(model.shown(s) + 1e-6); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };
  const finishClock = i => clock(riders[i].finish) + (model.estimated(i) ? ' EST' : '');
  const km = d => (d / 1000).toFixed(1);
  const gapText = g => { const s = Math.round(g); return s < 60 ? `+${s}s` : `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  // ---- the race, from the data -------------------------------------------------------------------
  const leads = events.filter(e => e.type === 'lead');
  const firstLead = leads[0], decisive = leads.at(-1); // the opening move and the one that won it
  const winner = model.winner, second = model.byFinish[1], third = model.byFinish[2];
  const attacker = decisive.rider, attacked = decisive.other, tAttack = decisive.t, tWin = riders[winner].finish;
  const chaser = events.find(e => e.type === 'pass' && e.t > decisive.t && e.rank === 2)?.rider ?? second;
  const plus = i => gapText(riders[i].finish - riders[winner].finish);
  const at = (i, t, key) => interpolate(riders[i].samples, t, key);
  const attackPower = model.best30(attacker);
  const chaseHr = model.peak(chaser, 'hr', tAttack - 30, tAttack + 120), lastHr = model.peak(second, 'hr', tWin - 60, riders[second].finish + 1);

  // Stamp for a phone clip: wall clock and road position, the facts the sync rests on.
  const stamp = (file, extra = {}) => {
    const c = clipInfo(file);
    const parts = [['REAL', '#ffd34d'], [c.created ? localTime(c.epoch, c.utcOffset) : '']];
    if (c.d != null && c.offRoad < 60) parts.push([`KM ${km(c.d)}`]);
    if (extra.place) parts.push([extra.place]);
    return { type: 'stamp', parts, at: 0.15, dur: extra.dur ?? 'end' };
  };
  // Race time on the clip's own (FIT-synced) clock at clip second `sec`.
  const clipT = (file, sec) => clipInfo(file).raceT0 + sec;

  const S = [];
  const seg = s => { S.push(s); return s; };
  const RED = '#ff4d5a', GREEN = '#3ddc84', GOLD = '#ffd34d';

  // ===== ACT 0 · COLD OPEN: the best real moments, at their own speed =============================
  seg({ id: 'open-wall', kind: 'clip', file: 'IMG_7782.MOV', dur: 2.6, src: { s: 0.2, speed: 1 }, enter: { type: 'fade', frames: 18 }, zoom: [1.06, 1.0], audio: 0.35, fit16: 'blur',
    cues: [{ type: 'title', at: 0.4, dur: 'end', y: 0.2, lines: [
      { text: 'MALLORCA · 17.10.2026', px: 32, w: 600, color: '#ffd34d', spacing: 0.24, gap: 12 },
      { text: `${WORDS[riders.length] ?? riders.length} RIDERS. ONE CLIMB.`, px: portrait ? 62 : 70, w: 700, spacing: 0.02 },
    ] }] });
  seg({ id: 'open-profile', kind: 'clip', file: 'IMG_7787.MOV', dur: 1.4, src: { s: 16.2, speed: 1 }, fit16: 'blur' });

  // ===== ACT 1 · TITLE: the mountain from the air ==================================================
  const P = f => ({ d: len * f });
  seg({ id: 'title', kind: '3d', dur: 4.0, snap: 'hit', enter: { type: 'whip', frames: 10 }, labels: 'none', focus: null, sfx: [{ name: 'riser', at: -2.0, gain: 0.35 }],
    time: { t: 0, speed: 0 },
    cam: { type: 'flyover', ease: 'inOut', fov: 44, path: [
      { ...P(1), off: [-1100, 950, -1900], look: { d: len * 0.82 } },
      { ...P(0.97), off: [-600, 560, -420], look: { d: len * 0.9 } },
      { ...P(0.62), off: [760, 470, 160], look: { d: len * 0.48 } },
      { ...P(0.28), off: [-640, 400, 520], look: { d: len * 0.12 } },
      { ...P(0), off: [-150, 170, 230], look: { d: 40 } },
    ] },
    cues: [
      { type: 'title', at: 0.4, dur: 'end', y: portrait ? 0.36 : 0.40, rule: 340, lines: [
        { text: 'WIELKI WYŚCIG', px: 34, w: 600, color: '#ffd34d', spacing: 0.3, gap: 10 },
        { text: 'COLL DE SA', px: portrait ? 132 : 150, gap: 0 },
        { text: 'BATALLA', px: portrait ? 132 : 150, gap: 22 },
        { text: `${km(len)} KM  ·  +${Math.round(model.stats.top - model.stats.start)} M  ·  ${riders.length} RIDERS`, px: 40, w: 600, spacing: 0.14 },
      ] },
      { type: 'profile', at: 2.8, dur: 'end', reveal: true, t: 0 },
    ] });

  // ===== ACT 2 · THE START: Caimari, the sign ======================================================
  const village = clipInfo('IMG_7771.MOV');
  const allSeven = (village.fitPasses ?? []).length === riders.length;
  seg({ id: 'caimari', kind: 'clip', file: 'IMG_7771.MOV', dur: 2.6, src: { s: 2.0, speed: 1 }, enter: { type: 'flash', frames: 8 },
    cues: [stamp('IMG_7771.MOV', { place: 'CAIMARI' }),
      { type: 'event', at: 0.2, dur: 'end', kicker: `CAIMARI · ${Math.round(model.stats.start)} M`, head: allSeven ? `All ${(WORDS[riders.length] ?? String(riders.length)).toLowerCase()}` : 'The group', sub: `${km(len)} km and ${Math.round(model.stats.top - model.stats.start)} m to the top` }] });
  seg({ id: 'sign', kind: 'clip', file: 'IMG_7772.MOV', dur: 2.2, src: { s: 0.1, speed: 1 }, fit16: 'blur',
    cues: [stamp('IMG_7772.MOV', { place: 'KM 0' }), { type: 'punch', at: 0.5, dur: 1.4, text: 'GO', px: 230 }] });

  // ===== RACE ON: the first moves, in the replay, pinned on the riders who made them ==================
  // (deriveEvents' passes on the first 15% of the road, past the start-line shuffle of its first 1%). A pass names
  // no place: the held race order only takes it up seconds later, and a caption may not say what does not yet hold.
  const passD = e => model.distance(e.rider, e.t);
  const earlyAll = events.filter(e => e.type === 'pass' && passD(e) > len * 0.01 && passD(e) < len * 0.15).sort((a, b) => a.t - b.t);
  // the busiest moment: the pass with the most passes in the 10 s from it (the first such, on a tie)
  const busiest = earlyAll.reduce((best, e) => { const n = earlyAll.filter(x => x.t >= e.t && x.t <= e.t + 10).length; return !best || n > best.n ? { e, n } : best; }, null);
  const early = busiest ? earlyAll.filter(e => e.t >= busiest.e.t) : [];
  if (early.length) {
    const t0 = Math.max(0, early[0].t - 6), speed = 3, dur = 4.4, at = t => (t - t0) / speed; // race time → segment second
    const shown = early.filter(e => at(e.t) < dur - 0.6);
    const movers = [...new Set(shown.map(e => e.rider))], passed = [...new Set(shown.map(e => e.other))];
    seg({ id: 'gun', kind: '3d', dur, focus: early[0].rider, labels: [...movers, ...passed], enter: { type: 'whip', frames: 10 },
      time: { t: t0, speed }, cam: { type: 'chase', rider: early[0].rider, group: true, reach: 120, dist: 95, phi: 1.2, ahead: 25, fov: 34, swing: 'auto' },
      callouts: [
        ...shown.map(e => ({ rider: e.rider, text: '↑', color: GREEN, at: at(e.t), dur: 'end' })),
        // one ↓ per rider passed, from the first time
        ...passed.map(i => ({ rider: i, text: '↓', color: RED, at: at(shown.find(e => e.other === i).t), dur: 'end' })),
      ],
      cues: [{ type: 'event', at: Math.max(0.3, at(shown[0].t) - 0.5), dur: 'end', kicker: `KM ${km(passD(shown[0]))} · ${clock(shown[0].t)}`,
        head: `${movers.map(name).join(' and ')} move up`, sub: `past ${passed.map(name).join(' and ')}` }] });
  }

  // ===== ACT 3 · THE CLIMB: the phones were there; so was the data ==================================
  // Data goes on the rider who is in the picture (clips.json, as Tom confirmed it).
  const seen = (file, k = 0) => R(clipInfo(file).sightings[k].rider);
  // Data shots run about 4 s, so the numbers stay up long enough to read.
  seg({ id: 'gorge', kind: 'clip', file: 'IMG_7774.MOV', dur: 4.0, src: { s: 0.0, speed: 1 },
    cues: [stamp('IMG_7774.MOV'), { type: 'rider', at: 0.4, dur: 'end', rider: seen('IMG_7774.MOV') }] });
  const passer = seen('IMG_7778.MOV'), passerPower = model.best30(passer);
  // the group comes up the gorge road; the rider seen is the last of the three past the camera, as the shot ends
  seg({ id: 'roadside', kind: 'clip', file: 'IMG_7778.MOV', dur: 4.0, src: { s: 2.2, speed: 1 }, enter: { type: 'flash', frames: 6 },
    cues: [stamp('IMG_7778.MOV'), passerPower
      ? { type: 'stat', at: 0.5, dur: 'end', rider: passer, value: passerPower.w, unit: 'W', label: `best 30 s of the climb · at ${clock(passerPower.t)}${passer === firstLead.rider ? ` · led from km ${km(model.distance(passer, firstLead.t))}` : ''}` }
      : { type: 'rider', at: 0.5, dur: 'end', rider: passer }] });
  // The stone wall: the front three, Los Locos in front (riding past the camera at 4–5.5 s). That heart rate
  // right then, and what it averaged over the whole climb.
  const front = R(clipInfo('IMG_7782.MOV').group[0]), tWall = clipT('IMG_7782.MOV', 5);
  seg({ id: 'wall', kind: 'clip', file: 'IMG_7782.MOV', dur: 4.2, src: { s: 3.0, speed: 1 }, audio: 0.3,
    cues: [stamp('IMG_7782.MOV'),
      ...(at(front, tWall, 'hr') != null ? [{ type: 'stat', at: 0.4, dur: 'end', rider: front, value: Math.round(at(front, tWall, 'hr')), unit: 'BPM', color: '#ff4d5a', label: `km ${km(model.distance(front, tWall))} · ${Math.round(model.avg(front, 'hr'))} bpm on average, the whole climb` }] : [])] });

  // ===== ACT 4 · THE ATTACK: no phone caught it; the data did =======================================
  // In the replay only the riders in the move are labelled: the rest of the race stays off the picture.
  const three = [attacked, attacker, chaser];
  seg({ id: 'build', kind: '3d', dur: 3.2, snap: 'bar', focus: attacked, labels: three, enter: { type: 'wipe', frames: 12 },
    time: { t: tAttack - 2, at: 3.2, speed: [[0, 5], [1.6, 3], [3.2, 1]] }, cam: { type: 'chase', rider: attacked, group: true, reach: 80, dist: 100, phi: 1.28, ahead: 30, fov: 34, swing: 'auto' },
    cues: [{ type: 'event', at: 0.3, dur: 2.8, kicker: `KM ${km(model.distance(attacked, tAttack - 60))} · ${clock(tAttack - 60)}`, head: 'Three together', sub: `${name(attacked)} leads, ${name(attacker)} and ${name(chaser)} on the wheel`, rider: attacked,
      claims: [{ rider: attacked, rank: 0 }], fallback: { sub: `${name(attacked)}, ${name(attacker)} and ${name(chaser)}` } }] });
  // The attack: a broadcast alert blinking on the beat and ATTACK pinned on the rider, in real time; then the
  // peak of the effort.
  const attackPeak = model.peak(attacker, 'watts', tAttack - 10, tAttack + 60);
  seg({ id: 'attack', kind: '3d', dur: 4.4, snap: 'bar', focus: attacker, labels: three, enter: { type: 'flash', frames: 8 }, sfx: [{ name: 'riser', at: -2.0, gain: 0.35 }],
    time: { t: tAttack, at: 0.4, speed: [[0, 1], [2.2, 1], [3.2, 2], [4.4, 2]] }, cam: { type: 'side', rider: attacker, dist: 90, fov: 26, ahead: 0, sign: -1, drift: 0.12, push: -0.03 },
    callouts: [{ rider: attacker, text: 'ATTACK', color: RED, at: 0, dur: 'end', blinkFor: 2.0 }],
    cues: [
      { type: 'alert', at: 0.0, dur: 1.8, text: 'ATTACK', y: 0.25, sub: attackPower ? `${name(attacker)} · ${Math.round(attackPower.w)} W for 30 s` : name(attacker) },
      ...(attackPeak ? [{ type: 'stat', at: 1.7, dur: 'end', y: 0.6, rider: attacker, value: attackPeak.watts, unit: 'W', label: `peak power in the attack · ${clock(attackPeak.t)}` }] : []),
    ] });
  // Away: the lead counting up on the race clock, from ahead of the road.
  seg({ id: 'attack-ahead', kind: '3d', dur: 3.2, focus: attacker, labels: [attacker],
    time: { t: tAttack + 12, speed: [[0, 1.5], [3.2, 2.5]] }, cam: { type: 'ahead', rider: attacker, dist: 380, fov: 15, push: -0.06, swing: 'auto' },
    cues: [{ type: 'gapclock', at: 0.2, dur: 'end', rider: attacker }] });
  // The answer behind: the next pass after the attack (Los Locos past El Szczupak), pinned on both.
  const counter = events.find(e => e.type === 'pass' && e.t > tAttack && e.t < tAttack + 120);
  if (counter) {
    const t0 = counter.t - 3, speed = 2, at = t => (t - t0) / speed;
    seg({ id: 'counter', kind: '3d', dur: 3.8, focus: counter.rider, labels: [counter.rider, counter.other],
      time: { t: t0, speed }, cam: { type: 'chase', rider: counter.rider, group: true, reach: 80, dist: 85, phi: 1.22, ahead: 20, fov: 30, swing: 'auto' },
      callouts: [
        { rider: counter.rider, text: '↑', color: GREEN, at: at(counter.t), dur: 'end' },
        { rider: counter.other, text: '↓', color: RED, at: at(counter.t), dur: 'end' },
      ],
      // the lead it chases is a place, so it is a claim: held for the caption's whole time, or left out
      cues: [{ type: 'event', at: Math.max(0.2, at(counter.t) - 0.6), dur: 'end', kicker: `KM ${km(model.distance(counter.rider, counter.t))} · ${clock(counter.t)}`,
        head: `${name(counter.rider)} passes ${name(counter.other)}`, sub: `the chase behind ${name(attacker)}`, rider: counter.rider,
        claims: [{ rider: attacker, rank: 0 }], fallback: { sub: '' } }] });
  }
  // On El Halcon's wheel after the attack: the live numbers, on the rider in the picture.
  const followed = seen('IMG_7786.MOV');
  seg({ id: 'wheel', kind: 'clip', file: 'IMG_7786.MOV', dur: 3.4, src: { s: 0.6, speed: 1 }, enter: { type: 'wipe', frames: 12 },
    cues: [stamp('IMG_7786.MOV'), { type: 'rider', at: 0.3, dur: 'end', rider: followed }] });
  // El Halcon in front, Los Locos behind: both in the picture (as Tom confirmed), both hearts on screen. The gap
  // stays out of the words: the FIT rides put Los Locos 19 s back here, the picture shows a rider much closer.
  const pair = clipInfo('IMG_7787.MOV').group.map(R), tPair = clipT('IMG_7787.MOV', 16.5);
  seg({ id: 'pass-profile', kind: 'clip', file: 'IMG_7787.MOV', dur: 4.0, src: { s: 14.2, speed: 1 }, audio: 0.2,
    cues: [stamp('IMG_7787.MOV'),
      { type: 'duel', at: 0.3, dur: 'end', metric: 'hr', riders: pair, colors: ['#f4f2ea', '#ff4d5a'], title: `heart rate · km ${km(model.distance(pair[0], tPair))}` }] });
  // Under the pines, 400 m from the top, the last footage before the line (the phone reached the col after the
  // first two): the power held since the attack. (No gap in numbers here either: the FIT rides and the picture
  // disagree on who is how far behind.)
  const pines = seen('IMG_7789.MOV'), tPines = clipT('IMG_7789.MOV', 3.7), held = model.avg(pines, 'watts', tAttack, tPines);
  seg({ id: 'pines', kind: 'clip', file: 'IMG_7789.MOV', dur: 3.8, src: { s: 0.2, speed: 1 },
    cues: [stamp('IMG_7789.MOV'),
      ...(held != null ? [{ type: 'stat', at: 0.3, dur: 'end', y: 0.22, rider: pines, value: held, unit: 'W', label: `average since the attack · ${Math.round((len - model.distance(pines, tPines)) / 50) * 50} m to the top` }] : []),
      { type: 'profile', at: 0.3, dur: 'end', focus: pines }] });
  // ...and on into the replay at the same second, a match cut: the rider has just passed the phone (its GPS fix is
  // off by tens of metres here, so the place comes from the rider's own track), and the replay watches him ride
  // away up the road from just behind that spot. The cut into it is not snapped, so the clip ends at exactly the
  // race time this shot starts from.
  const pinesEnd = 0.2 + 3.8; // the clip's last second: src s + the segment's length
  seg({ id: 'pines-3d', kind: '3d', dur: 1.6, snap: false, focus: pines, labels: [pines],
    time: { t: clipT('IMG_7789.MOV', pinesEnd), speed: 1 },
    cam: { type: 'roadside', d: model.distance(pines, clipT('IMG_7789.MOV', pinesEnd)) - 18, look: 'up', follow: pines, blend: 0.2, lateral: 6, height: 3.5, fov: 46 } });

  // ===== ACT 5 · THE SUMMIT: the win on data alone, then everyone the phones caught ==================
  seg({ id: 'finish', kind: '3d', dur: 3.4, snap: 'hit', focus: winner, labels: [winner], enter: { type: 'dip', frames: 8 },
    time: { t: tWin, at: 1.8, speed: [[0, 2], [1.2, 1], [1.8, 0.6], [3.4, 0.6]] }, cam: { type: 'chase', rider: winner, dist: 110, phi: 1.3, ahead: 45, lift: 10, fov: 30, push: -0.03 },
    callouts: [{ rider: winner, text: 'WINNER', color: GOLD, at: 1.8, dur: 'end' }],
    cues: [{ type: 'punch', at: 1.8, dur: 'end', text: clock(tWin), px: 230, sub: `${name(winner)} wins` }] });
  seg({ id: 'second', kind: '3d', dur: 2.4, focus: second, labels: [second], enter: { type: 'flash', frames: 6 },
    time: { t: riders[second].finish, at: 1.0, speed: 1 }, cam: { type: 'chase', rider: second, dist: 100, phi: 1.3, ahead: 45, lift: 10, fov: 30 },
    cues: [
      { type: 'event', at: 0.1, dur: 'end', kicker: 'SECOND', head: `${name(second)} ${plus(second)}`, rider: second },
      ...(lastHr ? [{ type: 'punch', at: 0.6, dur: 'end', text: `${lastHr.hr} BPM`, px: 140, y: 0.32, color: '#ff4d5a', sub: 'empties the tank' }] : []),
    ] });
  // Each finisher the phone caught at the col: the caption comes up just before they pass, with what their
  // heart or legs were doing right then (their own FIT-synced clock).
  const finisher = (file, i, s, sub = null) => {
    const t = clipT(file, s), hr = at(i, t, 'hr'), w = at(i, t, 'watts');
    const live = [hr != null ? `${Math.round(hr)} BPM` : null, w != null ? `${Math.round(w)} W` : null].filter(Boolean).join(' · ');
    return { type: 'finisher', rider: i, sub: sub ?? [plus(i), finishClock(i), live].filter(Boolean).join('  ·  ') };
  };
  const arrive = (id, file, s0, dur, more = {}) => {
    const c = clipInfo(file), sight = c.sightings?.[0];
    const i = R(sight.rider);
    seg({ id, kind: 'clip', file, dur, src: { s: s0, speed: 1 }, enter: more.enter, audio: more.audio, sfx: more.sfx,
      cues: [stamp(file, { place: 'THE COL' }), { ...finisher(file, i, sight.at, more.sub), at: 0.3, dur: 'end' }] });
  };
  arrive('col-3', 'IMG_7792.MOV', 1.0, 3.0, { enter: { type: 'flash', frames: 6 } });
  arrive('col-4', 'IMG_7793.MOV', 14.8, 3.0, { audio: 0.7 });
  // El Lobo lost a bet to Krzys; the penalty is the horn ("Klakson"). It sounds as El Lobo passes.
  const lobo = R('el-lobo'), krzys = R('krzys');
  arrive('col-5', 'IMG_7794.MOV', 8.6, 3.2, { sub: `${plus(lobo)}  ·  ${finishClock(lobo)}  ·  ${Math.round(riders[lobo].finish - riders[krzys].finish)} S BEHIND KRZYS: BET LOST`, sfx: [{ name: 'honk', at: 1.9 }] });
  const c95 = clipInfo('IMG_7795.MOV'), lastTwo = (c95.sightings ?? []).map(s => ({ i: R(s.rider), at: s.at }));
  if (lastTwo.length === 2) {
    const [a, b] = lastTwo, apart = Math.round(Math.abs(riders[a.i].finish - riders[b.i].finish));
    // With one of the two times an estimate (Karol has no official time) the gap is no number, just what the picture shows.
    const rel = model.estimated(a.i) || model.estimated(b.i) ? `RIGHT BEHIND ${name(a.i).toUpperCase()}`
      : `${apart} S ${riders[b.i].finish > riders[a.i].finish ? 'BEHIND' : 'FASTER THAN'} ${name(a.i).toUpperCase()}`;
    seg({ id: 'col-last', kind: 'clip', file: 'IMG_7795.MOV', dur: 5.2, src: { s: 0.0, speed: 1 }, audio: 0.6,
      cues: [stamp('IMG_7795.MOV', { place: 'THE COL' }),
        { ...finisher('IMG_7795.MOV', a.i, a.at), at: 0.1, dur: 2.4 },
        { ...finisher('IMG_7795.MOV', b.i, b.at, `${plus(b.i)}  ·  ${finishClock(b.i)}  ·  ${rel}`), at: 2.5, dur: 'end' },
      ] });
  }

  // ===== ACT 6 · FINALE: results, the gap chart, the end card ======================================
  // the results over the col itself (the summit sign, the café), softened
  seg({ id: 'results', kind: 'clip', file: 'IMG_7794.MOV', fit: 'bg', dim: 0.58, dur: 3.6, snap: 'bar', src: { s: 13.6, speed: 1 }, enter: { type: 'fade', frames: 12 },
    cues: [{ type: 'results', at: 0.2, dur: 'end' }] });
  seg({ id: 'gaps', kind: 'clip', file: 'IMG_7782.MOV', fit: 'bg', dim: 0.6, dur: 3.6, src: { s: 11.0, speed: 1 },
    cues: [{ type: 'gaps', at: 0.15, dur: 'end' }] });
  seg({ id: 'end', kind: 'clip', file: 'IMG_7795.MOV', fit: 'bg', dim: 0.66, dur: 2.6, src: { s: 3.6, speed: 1 }, enter: { type: 'fade', frames: 12 },
    cues: [{ type: 'end', at: 0.1, dur: 'end', credits: [
      ...(credits.music ? [credits.music] : []),
      'Aerial imagery and 5 m LiDAR elevation © IGN (PNOA, MDT05), CC BY 4.0',
      'Road © OpenStreetMap contributors (ODbL) · Ride data: the riders\' own FIT files',
    ] }] });

  const spans = [
    { type: 'bug', from: S.some(s => s.id === 'gun') ? 'gun' : 'gorge', to: 'pines' },
  ];
  return { segments: S, spans, facts: { attacker, attacked, chaser, winner, tAttack, tWin, attackPower, chaseHr, lastHr } };
}

const WORDS = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE'];
function localTime(epoch, offset) {
  const sign = offset?.[0] === '-' ? -1 : 1, mins = offset ? sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3, 5))) : 0;
  const d = new Date((epoch + mins * 60) * 1000);
  return [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map(v => String(v).padStart(2, '0')).join(':');
}

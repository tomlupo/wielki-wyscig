// The edit: the race told in acts, mostly on the riders' own phone footage with their data on it
// (power, heart rate, gaps, places), the 3D replay only where no phone was: the title, the attack,
// the win. Segments carry nominal durations (the planner snaps every cut to the music) and the
// graphics that ride on them.
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
  const gapText = g => g < 60 ? `+${Math.round(g)}s` : `+${Math.floor(g / 60)}:${String(Math.round(g % 60)).padStart(2, '0')}`;

  // ---- the race, from the data -------------------------------------------------------------------
  const leads = events.filter(e => e.type === 'lead');
  const firstLead = leads[0], decisive = leads.at(-1); // the opening move and the one that won it
  const winner = model.winner, second = model.byFinish[1], third = model.byFinish[2];
  const attacker = decisive.rider, attacked = decisive.other, tAttack = decisive.t, tWin = riders[winner].finish;
  const chaser = events.find(e => e.type === 'pass' && e.t > decisive.t && e.rank === 2)?.rider ?? second;
  const plus = i => gapText(riders[i].finish - riders[winner].finish);
  // A rider's strongest 30 s of power, and their highest heart rate, with when.
  const best30 = i => {
    const s = riders[i].samples.filter(x => x.watts != null);
    let best = null;
    for (let a = 0; a < s.length; a++) { let sum = 0, n = 0; for (let b = a; b < s.length && s[b].t - s[a].t <= 30; b++) { sum += s[b].watts; n++; } if (n > 3 && (!best || sum / n > best.w)) best = { w: sum / n, t: s[a].t }; }
    return best;
  };
  const peakHr = (i, t0 = 0, t1 = Infinity) => riders[i].samples.filter(x => x.hr != null && x.t >= t0 && x.t <= t1).reduce((m, x) => !m || x.hr > m.hr ? x : m, null);
  const avgOf = (i, key, t0 = 0, t1 = Infinity) => { const x = riders[i].samples.filter(p => p[key] != null && p.t >= t0 && p.t <= t1); return x.length ? x.reduce((s, p) => s + p[key], 0) / x.length : null; };
  const at = (i, t, key) => interpolate(riders[i].samples, t, key);
  const attackPower = best30(attacker);
  const chaseHr = peakHr(chaser, tAttack - 30, tAttack + 120), lastHr = peakHr(second, tWin - 60, riders[second].finish + 1);

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

  // ===== ACT 0 · COLD OPEN: the best real moments, slowed down ====================================
  seg({ id: 'open-wall', kind: 'clip', file: 'IMG_7782.MOV', dur: 2.8, src: { s: 0.8, speed: 0.5 }, enter: { type: 'fade', frames: 18 }, zoom: [1.06, 1.0], audio: 0.35, fit16: 'blur',
    cues: [{ type: 'title', at: 0.4, dur: 'end', y: 0.2, lines: [
      { text: 'MALLORCA · 17.10.2026', px: 32, w: 600, color: '#ffd34d', spacing: 0.24, gap: 12 },
      { text: `${WORDS[riders.length] ?? riders.length} RIDERS. ONE CLIMB.`, px: portrait ? 62 : 70, w: 700, spacing: 0.02 },
    ] }] });
  seg({ id: 'open-profile', kind: 'clip', file: 'IMG_7787.MOV', dur: 1.8, src: { s: 16.2, speed: 0.5 }, fit16: 'blur' });
  seg({ id: 'open-hairpin', kind: 'clip', file: 'IMG_7794.MOV', dur: 1.8, src: { s: 9.5, speed: 1 }, fit16: 'blur' });

  // ===== ACT 1 · TITLE: the mountain from the air ==================================================
  const P = f => ({ d: len * f });
  seg({ id: 'title', kind: '3d', dur: 5.4, snap: 'hit', enter: { type: 'whip', frames: 10 }, labels: 'none', focus: null,
    time: { t: 0, speed: 0 },
    cam: { type: 'flyover', ease: 'inOut', fov: 44, path: [
      { ...P(1), off: [-1100, 950, -1900], look: { d: len * 0.82 } },
      { ...P(0.97), off: [-600, 560, -420], look: { d: len * 0.9 } },
      { ...P(0.62), off: [760, 470, 160], look: { d: len * 0.48 } },
      { ...P(0.28), off: [-640, 400, 520], look: { d: len * 0.12 } },
      { ...P(0), off: [-150, 170, 230], look: { d: 40 } },
    ] },
    cues: [
      { type: 'title', at: 0.5, dur: 4.2, y: portrait ? 0.36 : 0.40, rule: 340, lines: [
        { text: 'WIELKI WYŚCIG', px: 34, w: 600, color: '#ffd34d', spacing: 0.3, gap: 10 },
        { text: 'COLL DE SA', px: portrait ? 132 : 150, gap: 0 },
        { text: 'BATALLA', px: portrait ? 132 : 150, gap: 22 },
        { text: `${km(len)} KM  ·  +${Math.round(model.stats.top - model.stats.start)} M  ·  ${riders.length} RIDERS`, px: 40, w: 600, spacing: 0.14 },
      ] },
      { type: 'profile', at: 2.8, dur: 'end', reveal: true, t: 0 },
    ] });

  // ===== ACT 2 · THE START: the roll-out, Caimari, the sign ========================================
  seg({ id: 'rollout', kind: 'clip', file: 'IMG_5364.MOV', dur: 2.2, src: { s: 0.2, speed: 1 }, enter: { type: 'flash', frames: 8 }, fit16: 'blur',
    cues: [stamp('IMG_5364.MOV', { place: 'THE ROLL-OUT' })] });
  const village = clipInfo('IMG_7771.MOV');
  const allSeven = (village.fitPasses ?? []).length === riders.length;
  seg({ id: 'caimari', kind: 'clip', file: 'IMG_7771.MOV', dur: 2.6, src: { s: 2.0, speed: [[0, 1.2], [1.4, 1.2], [2.0, 0.7]] },
    cues: [stamp('IMG_7771.MOV', { place: 'CAIMARI' }),
      { type: 'event', at: 0.5, dur: 'end', kicker: `CAIMARI · ${Math.round(model.stats.start)} M`, head: allSeven ? 'All seven' : 'The group', sub: `${km(len)} km and ${Math.round(model.stats.top - model.stats.start)} m to the top` }] });
  seg({ id: 'sign', kind: 'clip', file: 'IMG_7772.MOV', dur: 2.2, src: { s: 0.1, speed: 1 }, fit16: 'blur',
    cues: [stamp('IMG_7772.MOV', { place: 'KM 0' }), { type: 'punch', at: 0.5, dur: 1.4, text: 'GO', px: 230 }] });

  // ===== ACT 3 · THE CLIMB: the phones were there; so was the data ==================================
  // Data goes on the rider who is in the picture (clips.json, as Tom confirmed it).
  const seen = (file, k = 0) => R(clipInfo(file).sightings[k].rider);
  seg({ id: 'gorge', kind: 'clip', file: 'IMG_7774.MOV', dur: 3.4, src: { s: 0.0, speed: 1 },
    cues: [stamp('IMG_7774.MOV'), { type: 'rider', at: 0.5, dur: 'end', rider: seen('IMG_7774.MOV') }] });
  seg({ id: 'heli-early', kind: '3d', dur: 2.4, focus: firstLead.rider, labels: 'all', enter: { type: 'zoom', frames: 8 },
    time: { t: 240, speed: [[0, 60], [2.4, 80]] }, cam: { type: 'heli', rider: firstLead.rider, group: true, reach: 600, radius: 1300, phi: 0.6, spin: 0.05, theta: 0.3, fov: 34 },
    cues: [{ type: 'standings', at: 0.2, dur: 'end', top: riders.length }] });
  const passer = seen('IMG_7778.MOV'), passerPower = best30(passer);
  // the group comes up the gorge road; the rider seen is the last of the three past the camera, as the shot ends
  seg({ id: 'roadside', kind: 'clip', file: 'IMG_7778.MOV', dur: 3.6, src: { s: 2.8, speed: 1 }, enter: { type: 'flash', frames: 6 },
    cues: [stamp('IMG_7778.MOV'), passerPower
      ? { type: 'stat', at: 0.5, dur: 'end', rider: passer, value: passerPower.w, unit: 'W', label: `best 30 s of the climb · at ${clock(passerPower.t)}${passer === firstLead.rider ? ` · led from km ${km(model.distance(passer, firstLead.t))}` : ''}` }
      : { type: 'rider', at: 0.5, dur: 'end', rider: passer }] });
  // The stone wall: the front three, Los Locos in front (riding past the camera at 4–5.5 s). That heart rate
  // right then, and what it averaged over the whole climb.
  const front = R(clipInfo('IMG_7782.MOV').group[0]), tWall = clipT('IMG_7782.MOV', 5);
  seg({ id: 'wall', kind: 'clip', file: 'IMG_7782.MOV', dur: 3.8, src: { s: 3.2, speed: 1 }, audio: 0.3,
    cues: [stamp('IMG_7782.MOV'),
      ...(at(front, tWall, 'hr') != null ? [{ type: 'stat', at: 0.4, dur: 'end', rider: front, value: Math.round(at(front, tWall, 'hr')), unit: 'BPM', color: '#ff4d5a', label: `km ${km(model.distance(front, tWall))} · ${Math.round(avgOf(front, 'hr'))} bpm on average, the whole climb` }] : [])] });

  // ===== ACT 4 · THE ATTACK: no phone caught it; the data did =======================================
  seg({ id: 'build', kind: '3d', dur: 2.6, snap: 'bar', focus: attacked, labels: 'all', enter: { type: 'wipe', frames: 12 },
    time: { t: tAttack - 12, at: 2.6, speed: [[0, 14], [1.4, 8], [2.6, 2]] }, cam: { type: 'chase', rider: attacked, group: true, reach: 80, dist: 100, phi: 1.28, ahead: 30, fov: 34, swing: 'auto' },
    cues: [{ type: 'event', at: 0.3, dur: 2.2, kicker: `KM ${km(model.distance(attacked, tAttack - 60))} · ${clock(tAttack - 60)}`, head: 'Three together', sub: `${name(attacked)} leads, ${name(attacker)} and ${name(chaser)} on the wheel`, rider: attacked,
      claims: [{ rider: attacked, rank: 0 }], fallback: { sub: `${name(attacked)}, ${name(attacker)} and ${name(chaser)}` } }] });
  seg({ id: 'attack', kind: '3d', dur: 3.8, snap: 'hit', focus: attacker, labels: 'names', enter: { type: 'flash', frames: 8 },
    // slow motion from the outside of the hairpin, then time runs on while the attacker's power trace draws itself
    time: { t: tAttack, at: 0.6, speed: [[0, 0.6], [1.4, 0.5], [2.4, 7], [3.8, 7]] }, cam: { type: 'side', rider: attacker, dist: 90, fov: 26, ahead: 0, sign: -1, drift: 0.12, push: -0.03 },
    cues: [
      { type: 'punch', at: 0.0, dur: 1.4, text: 'ATTACK', px: 200, y: 0.42, sub: attackPower ? `${Math.round(attackPower.w)} W FOR 30 SECONDS` : `${name(attacker)}` },
      ...(attackPower ? [{ type: 'trace', at: 1.2, dur: 'end', rider: attacker, metric: 'watts', window: [tAttack - 50, tAttack + 40], band: [attackPower.t, attackPower.t + 30], bandLabel: `${Math.round(attackPower.w)} W · 30 S` }] : []),
    ] });
  seg({ id: 'attack-ahead', kind: '3d', dur: 2.4, focus: attacker, labels: 'names',
    time: { t: tAttack + 30, speed: [[0, 3], [2.4, 6]] }, cam: { type: 'ahead', rider: attacker, dist: 380, fov: 15, push: -0.06, swing: 'auto' },
    cues: [{ type: 'event', at: 0.2, dur: 2.1, kicker: `KM ${km(model.distance(attacker, tAttack))} · ${clock(tAttack)}`, head: `${name(attacker)} attacks`, sub: `takes the lead from ${name(attacked)}`, rider: attacker }] });
  // On El Halcon's wheel after the attack: the live numbers, on the rider in the picture.
  const followed = seen('IMG_7786.MOV');
  seg({ id: 'wheel', kind: 'clip', file: 'IMG_7786.MOV', dur: 2.6, src: { s: 0.6, speed: 1 }, enter: { type: 'wipe', frames: 12 },
    cues: [stamp('IMG_7786.MOV'), { type: 'rider', at: 0.3, dur: 'end', rider: followed }] });
  // El Halcon in front, Los Locos behind: both in the picture (as Tom confirmed), both hearts on screen. The gap
  // stays out of the words: the FIT rides put Los Locos 19 s back here, the picture shows a rider much closer.
  const pair = clipInfo('IMG_7787.MOV').group.map(R), tPair = clipT('IMG_7787.MOV', 16.5);
  seg({ id: 'pass-profile', kind: 'clip', file: 'IMG_7787.MOV', dur: 3.6, src: { s: 17.0, at: 2.6, speed: [[0, 1], [1.4, 1], [1.8, 0.45], [3.6, 0.45]] }, audio: 0.2,
    cues: [stamp('IMG_7787.MOV'),
      { type: 'duel', at: 0.3, dur: 'end', metric: 'hr', riders: pair, colors: ['#f4f2ea', '#ff4d5a'], title: `heart rate · km ${km(model.distance(pair[0], tPair))}` }] });
  // Under the pines, 400 m from the top: the power held since the attack. (No gap in numbers here either: the
  // FIT rides and the picture disagree on who is how far behind.)
  const pines = seen('IMG_7789.MOV'), tPines = clipT('IMG_7789.MOV', 3.7), held = avgOf(pines, 'watts', tAttack, tPines);
  seg({ id: 'pines', kind: 'clip', file: 'IMG_7789.MOV', dur: 2.6, src: { s: 0.2, speed: 1 },
    cues: [stamp('IMG_7789.MOV'),
      ...(held != null ? [{ type: 'stat', at: 0.3, dur: 'end', y: 0.22, rider: pines, value: held, unit: 'W', label: `average since the attack · ${Math.round((len - model.distance(pines, tPines)) / 50) * 50} m to the top` }] : []),
      { type: 'profile', at: 0.3, dur: 'end', focus: pines }] });

  // ===== ACT 5 · THE SUMMIT: the win on data alone, then everyone the phones caught ==================
  seg({ id: 'finish', kind: '3d', dur: 3.2, snap: 'hit', focus: winner, labels: 'names', enter: { type: 'dip', frames: 8 },
    time: { t: tWin, at: 1.8, speed: [[0, 4], [1.0, 1], [1.8, 0.5], [3.2, 0.5]] }, cam: { type: 'chase', rider: winner, dist: 110, phi: 1.3, ahead: 45, lift: 10, fov: 30, push: -0.03 },
    cues: [{ type: 'punch', at: 1.8, dur: 1.4, text: clock(tWin), px: 230, sub: `${name(winner)} wins` }] });
  seg({ id: 'second', kind: '3d', dur: 2.0, focus: second, labels: 'names', enter: { type: 'flash', frames: 6 },
    time: { t: riders[second].finish, at: 1.0, speed: 1 }, cam: { type: 'chase', rider: second, dist: 100, phi: 1.3, ahead: 45, lift: 10, fov: 30 },
    cues: [
      { type: 'event', at: 0.1, dur: 1.9, kicker: 'SECOND', head: `${name(second)} ${plus(second)}`, rider: second },
      ...(lastHr ? [{ type: 'punch', at: 0.3, dur: 1.7, text: `${lastHr.hr} BPM`, px: 140, y: 0.32, color: '#ff4d5a', sub: 'empties the tank' }] : []),
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
      cues: [stamp(file, { place: 'THE COL' }), { ...finisher(file, i, sight.at, more.sub), at: Math.max(0.1, sight.at - s0 - 1.0), dur: 'end' }] });
  };
  arrive('col-3', 'IMG_7792.MOV', 1.4, 2.4, { enter: { type: 'flash', frames: 6 } });
  arrive('col-4', 'IMG_7793.MOV', 15.4, 2.4, { audio: 0.7 });
  // El Lobo lost a bet to Krzys; the penalty is the horn ("Klakson"). It sounds as El Lobo passes.
  const lobo = R('el-lobo'), krzys = R('krzys');
  arrive('col-5', 'IMG_7794.MOV', 8.9, 2.5, { sub: `${plus(lobo)}  ·  ${finishClock(lobo)}  ·  ${Math.round(riders[lobo].finish - riders[krzys].finish)} S BEHIND KRZYS: BET LOST`, sfx: [{ name: 'honk', at: 1.9 }] });
  const c95 = clipInfo('IMG_7795.MOV'), lastTwo = (c95.sightings ?? []).map(s => ({ i: R(s.rider), at: s.at }));
  if (lastTwo.length === 2) {
    const [a, b] = lastTwo, apart = Math.round(Math.abs(riders[a.i].finish - riders[b.i].finish));
    // With one of the two times an estimate (Karol has no official time) the gap is no number, just what the picture shows.
    const rel = model.estimated(a.i) || model.estimated(b.i) ? `RIGHT BEHIND ${name(a.i).toUpperCase()}`
      : `${apart} S ${riders[b.i].finish > riders[a.i].finish ? 'BEHIND' : 'FASTER THAN'} ${name(a.i).toUpperCase()}`;
    seg({ id: 'col-last', kind: 'clip', file: 'IMG_7795.MOV', dur: 3.8, src: { s: 0.0, speed: 1 }, audio: 0.6,
      cues: [stamp('IMG_7795.MOV', { place: 'THE COL' }),
        { ...finisher('IMG_7795.MOV', a.i, a.at), at: 0.1, dur: 1.8 },
        { ...finisher('IMG_7795.MOV', b.i, b.at, `${plus(b.i)}  ·  ${finishClock(b.i)}  ·  ${rel}`), at: 1.9, dur: 'end' },
      ] });
  }

  // ===== ACT 6 · FINALE: results, the gap chart, the end card ======================================
  // the results over the col itself (the summit sign, the café), softened
  seg({ id: 'results', kind: 'clip', file: 'IMG_7794.MOV', fit: 'bg', dim: 0.58, dur: 3.8, snap: 'bar', src: { s: 13.6, speed: 0.4 }, enter: { type: 'fade', frames: 12 },
    cues: [{ type: 'results', at: 0.2, dur: 'end' }] });
  seg({ id: 'gaps', kind: 'clip', file: 'IMG_7782.MOV', fit: 'bg', dim: 0.6, dur: 3.8, src: { s: 11.0, speed: 0.4 },
    cues: [{ type: 'gaps', at: 0.15, dur: 'end' }] });
  seg({ id: 'selfie', kind: 'clip', file: 'VMGY3907.MP4', dur: 1.6, src: { s: 0.6, speed: 1 }, enter: { type: 'flash', frames: 6 }, fit16: 'blur', audio: 0.6 });
  seg({ id: 'end', kind: 'clip', file: 'IMG_7795.MOV', fit: 'bg', dim: 0.66, dur: 3.2, src: { s: 3.6, speed: 0.4 }, enter: { type: 'fade', frames: 12 },
    cues: [{ type: 'end', at: 0.1, dur: 'end', credits: [
      ...(credits.music ? [credits.music] : []),
      'Aerial imagery and 5 m LiDAR elevation © IGN (PNOA, MDT05), CC BY 4.0',
      'Road © OpenStreetMap contributors (ODbL) · Ride data: the riders\' own FIT files',
    ] }] });

  const spans = [
    { type: 'bug', from: 'gorge', to: 'pines', skip: ['heli-early'] },
  ];
  return { segments: S, spans, facts: { attacker, attacked, chaser, winner, tAttack, tWin, attackPower, chaseHr, lastHr } };
}

const WORDS = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE'];
export function ordinal(n) { return n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] ?? 'th'); }
function localTime(epoch, offset) {
  const sign = offset?.[0] === '-' ? -1 : 1, mins = offset ? sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3, 5))) : 0;
  const d = new Date((epoch + mins * 60) * 1000);
  return [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map(v => String(v).padStart(2, '0')).join(':');
}

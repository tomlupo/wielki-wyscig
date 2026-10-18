// The edit: the race told in acts, as a list of segments with nominal durations (the planner
// snaps every cut to the music's beats) and the graphics that ride on them.
//
// Race moments come from the data (deriveEvents, standings), clip moments from the editor's
// log (clips.json) and the sync (sync.json). Nothing here is a hard-coded race time that the
// data could contradict: change race.json and the attack, the winner and the gaps follow.
//
// Segment: { id, kind: '3d' | 'clip' | 'card', dur, enter?: { type, frames } , snap?: 'bar' | 'beat' | false, ... }
//   3d:   cam (src/reel/camera.js spec), time: { t, at = 0, speed (number | [[sec, speed]]) }, focus, labels
//   clip: file, src: { s, at = 0, speed }, fit, focal, zoom, audio, twin (16:9: the 3D camera beside the clip)
//   cues: [{ type, at, dur | 'end', ...props }] relative to the segment start
// Spans: [{ type, from: segId, to: segId, ... }] graphics that stay up across several segments.

export function storyboard({ model, sync, fmt, credits = {} }) {
  const { riders, events, len, duration } = model;
  const portrait = fmt === '9x16';
  const R = id => { const i = riders.findIndex(r => r.id === id); if (i < 0) throw new Error(`no rider ${id}`); return i; };
  const name = i => riders[i].name;
  const clipInfo = f => { const c = sync.clips.find(x => x.file === f); if (!c) throw new Error(`no clip ${f}`); return c; };

  // ---- the race, from the data -----------------------------------------------------------------
  const leads = events.filter(e => e.type === 'lead');
  const firstLead = leads[0], decisive = leads.at(-1); // the opening move and the one that won it
  const winner = model.winner, second = model.byFinish[1], third = model.byFinish[2];
  const attacker = decisive.rider, attacked = decisive.other;
  const chaser = events.find(e => e.type === 'pass' && e.t > decisive.t && e.rank === 2)?.rider ?? second;
  const tAttack = decisive.t;
  const tWin = riders[winner].finish;
  // The attacker's strongest 30 s (the number on screen when he goes).
  const best30 = (() => {
    const s = riders[attacker].samples.filter(x => x.watts != null);
    let best = { w: 0, t: tAttack };
    for (let i = 0; i < s.length; i++) { let sum = 0, n = 0; for (let j = i; j < s.length && s[j].t - s[i].t <= 30; j++) { sum += s[j].watts; n++; } if (n > 2 && sum / n > best.w) best = { w: sum / n, t: s[i].t }; }
    return best;
  })();
  const chaserHr = Math.max(...riders[chaser].samples.filter(x => x.t > tAttack - 30 && x.t < tAttack + 90 && x.hr != null).map(x => x.hr), 0);
  const gapAtFinish = g => g < 60 ? `+${Math.round(g)}s` : `+${Math.floor(g / 60)}:${String(Math.round(g % 60)).padStart(2, '0')}`;
  const plus = i => gapAtFinish(riders[i].finish - riders[winner].finish);
  const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const km = d => (d / 1000).toFixed(1);

  // Stamp for a phone clip: wall clock and road position, the facts the match cut rests on.
  const stamp = (file, extra = {}) => {
    const c = clipInfo(file);
    const parts = [['REAL', '#ffd34d'], [c.created ? localTime(c.epoch, c.utcOffset) : '']];
    if (c.d != null && c.offRoad < 60) parts.push([`KM ${km(c.d)}`]);
    if (extra.place) parts.push([extra.place]);
    return { type: 'stamp', parts, at: 0.15, dur: extra.dur ?? 'end', y: extra.y };
  };

  // 16:9 only: the 3D twin beside a phone clip, a roadside camera at the clip's road point.
  const twin = (file, look = 'down') => ({ type: 'roadside', d: clipInfo(file).d, lateral: 14, height: 10, look, fov: 46 });

  const S = []; // segments
  const seg = s => { S.push(s); return s; };

  // ===== ACT 0 · COLD OPEN: the best real moments, slowed down ==================================
  seg({ id: 'open-wall', kind: 'clip', file: 'IMG_7782.MOV', dur: 2.8, src: { s: 2.2, speed: 0.5 }, enter: { type: 'fade', frames: 18 }, zoom: [1.06, 1.0], audio: 0.5,
    cues: [{ type: 'title', at: 0.4, dur: 'end', y: portrait ? 0.2 : 0.2, lines: [
      { text: 'MALLORCA · 17.10.2026', px: 32, w: 600, color: '#ffd34d', spacing: 0.24, gap: 12 },
      { text: `${WORDS[riders.length] ?? riders.length} RIDERS. ONE CLIMB.`, px: portrait ? 62 : 70, w: 700, spacing: 0.02 },
    ] }] });
  seg({ id: 'open-wheel', kind: 'clip', file: 'IMG_7786.MOV', dur: 1.7, src: { s: 0.4, speed: 0.8 }, zoom: [1.0, 1.08] });
  seg({ id: 'open-hairpin', kind: 'clip', file: 'IMG_7794.MOV', dur: 1.9, src: { s: 9.5, speed: 1 } });

  // ===== ACT 1 · TITLE: the mountain from the air =================================================
  const P = f => ({ d: len * f });
  seg({ id: 'title', kind: '3d', dur: 5.8, snap: 'hit', enter: { type: 'whip', frames: 10 }, labels: 'none', focus: null,
    time: { t: 0, speed: 0 },
    cam: { type: 'flyover', ease: 'inOut', fov: 44, path: [
      { ...P(1), off: [-1100, 950, -1900], look: { d: len * 0.82 } },
      { ...P(0.97), off: [-600, 560, -420], look: { d: len * 0.9 } },
      { ...P(0.62), off: [760, 470, 160], look: { d: len * 0.48 } },
      { ...P(0.28), off: [-640, 400, 520], look: { d: len * 0.12 } },
      { ...P(0), off: [-150, 170, 230], look: { d: 40 } },
    ] },
    cues: [
      { type: 'title', at: 0.6, dur: 4.6, y: portrait ? 0.36 : 0.40, rule: 340, lines: [
        { text: 'WIELKI WYŚCIG', px: 34, w: 600, color: '#ffd34d', spacing: 0.3, gap: 10 },
        { text: 'COLL DE SA', px: portrait ? 132 : 150, gap: 0 },
        { text: 'BATALLA', px: portrait ? 132 : 150, gap: 22 },
        { text: `${km(len)} KM  ·  +${Math.round(model.stats.top - model.stats.start)} M  ·  ${riders.length} RIDERS`, px: 40, w: 600, spacing: 0.14 },
      ] },
      { type: 'profile', at: 3.2, dur: 'end', reveal: true, t: 0 },
    ] });

  // ===== ACT 2 · THE START: Caimari, the sign, the gun ============================================
  seg({ id: 'caimari', kind: 'clip', file: 'IMG_7771.MOV', dur: 2.2, src: { s: 2.0, speed: [[0, 1.2], [1.4, 1.2], [2.0, 0.7]] }, enter: { type: 'flash', frames: 8 }, twin: null,
    cues: [stamp('IMG_7771.MOV', { place: 'CAIMARI' })] });
  seg({ id: 'sign', kind: 'clip', file: 'IMG_7772.MOV', dur: 2.0, src: { s: 0.1, speed: 1 }, twin: null,
    cues: [stamp('IMG_7772.MOV', { place: 'KM 0' })] });
  seg({ id: 'start-3d', kind: '3d', dur: 2.4, enter: { type: 'wipe', frames: 14 }, focus: firstLead.rider, labels: 'all',
    time: { t: 2, speed: 5 }, cam: { type: 'chase', rider: firstLead.rider, group: true, dist: 95, phi: 1.3, ahead: 35, fov: 38, swing: 'auto', push: -0.04 },
    cues: [{ type: 'punch', at: 0.35, dur: 1.4, text: 'GO', px: 220 }] });
  seg({ id: 'first-lead', kind: '3d', dur: 2.8, focus: firstLead.rider, labels: 'all',
    time: { t: firstLead.t, at: 1.4, speed: [[0, 6], [1.0, 3], [2.0, 3], [3.2, 6]] }, cam: { type: 'side', rider: firstLead.rider, group: true, reach: 60, dist: 130, fov: 24, sign: 'auto', push: -0.04 },
    cues: [{ type: 'event', at: 0.9, dur: 2.1, kicker: `KM ${km(model.distance(firstLead.rider, firstLead.t))} · ${clock(firstLead.t)}`, head: `${name(firstLead.rider)} goes`, sub: `takes the lead from ${name(firstLead.other)}`, rider: firstLead.rider }] });

  // ===== ACT 3 · THE CLIMB: the race strings out; the phones were there ===========================
  const c74 = clipInfo('IMG_7774.MOV');
  seg({ id: 'heli-early', kind: '3d', dur: 2.6, focus: firstLead.rider, labels: 'all',
    time: { t: 60, speed: [[0, 30], [3.0, 50]] }, cam: { type: 'heli', rider: firstLead.rider, group: true, reach: 600, radius: 1300, phi: 0.6, spin: 0.05, theta: 0.3, fov: 34 },
    cues: [{ type: 'standings', at: 0.3, dur: 'end', top: riders.length }] });
  seg({ id: 'fly-gorge', kind: '3d', dur: 1.8, focus: null, labels: 'all',
    time: { t: c74.raceT0 - 1.8 * 4, speed: 4 }, cam: { type: 'flyto', after: 'heli-early', to: { type: 'roadside', d: c74.d - 30, lateral: 0, height: 12, look: 'up', fov: 50 } } });
  seg({ id: 'gorge', kind: 'clip', file: 'IMG_7774.MOV', dur: 3.0, src: { s: 0.0, speed: 1 }, enter: { type: 'wipe', frames: 12 }, twin: twin('IMG_7774.MOV', 'up'),
    cues: [stamp('IMG_7774.MOV')] });

  const c78 = clipInfo('IMG_7778.MOV');
  seg({ id: 'orbit-trio', kind: '3d', dur: 2.4, focus: R('el-szczupak'), labels: 'all', enter: { type: 'zoom', frames: 10 },
    time: { t: 330, speed: [[0, 70], [2.8, 70]] }, cam: { type: 'orbit', rider: R('el-szczupak'), group: true, reach: 120, radius: 420, phi: 1.08, theta: 1.2, spin: 0.16, fov: 36 },
    cues: [{ type: 'standings', at: 0.2, dur: 'end', top: riders.length }] });
  seg({ id: 'fly-roadside', kind: '3d', dur: 1.6, focus: null, labels: 'all',
    time: { t: c78.raceT0 - 1.6 * 3, speed: 3 }, cam: { type: 'flyto', after: 'orbit-trio', to: { type: 'roadside', d: c78.d, lateral: 12, height: 9, look: 'down', back: 90, fov: 46 } } });
  seg({ id: 'roadside', kind: 'clip', file: 'IMG_7778.MOV', dur: 3.4, src: { s: 2.0, speed: 1 }, enter: { type: 'wipe', frames: 12 }, twin: twin('IMG_7778.MOV'),
    cues: [stamp('IMG_7778.MOV')] });

  const c82 = clipInfo('IMG_7782.MOV');
  seg({ id: 'wall', kind: 'clip', file: 'IMG_7782.MOV', dur: 3.6, src: { s: 8.4, speed: 1 }, enter: { type: 'wipe', frames: 12 }, twin: twin('IMG_7782.MOV', 'up'), audio: 0.4,
    cues: [stamp('IMG_7782.MOV'), { type: 'standings', at: 0.5, dur: 3.4, top: 3, title: 'AT THIS MOMENT', y: portrait ? null : null }] });

  // ===== ACT 4 · THE ATTACK: the move that won it, then the chase ==================================
  seg({ id: 'build', kind: '3d', dur: 2.8, snap: 'bar', focus: attacked, labels: 'all', enter: { type: 'flash', frames: 6 },
    time: { t: tAttack - 12, at: 3.0, speed: [[0, 14], [1.6, 8], [3.0, 2]] }, cam: { type: 'chase', rider: attacked, group: true, reach: 80, dist: 100, phi: 1.28, ahead: 30, fov: 34, swing: 'auto' },
    cues: [{ type: 'event', at: 0.4, dur: 2.4, kicker: `KM ${km(model.distance(attacked, tAttack - 60))} · ${clock(tAttack - 60)}`, head: 'Three together', sub: `${name(attacked)} leads, ${name(attacker)} and ${name(chaser)} on the wheel`, rider: attacked,
      claims: [{ rider: attacked, rank: 0 }], fallback: { sub: `${name(attacked)}, ${name(attacker)} and ${name(chaser)}` } }] });
  seg({ id: 'attack', kind: '3d', dur: 3.6, snap: 'hit', focus: attacker, labels: 'names', enter: { type: 'flash', frames: 8 },
    // Slow motion from the outside of the hairpin, the camera drifting round, then time runs on until he holds the lead.
    time: { t: tAttack, at: 0.6, speed: [[0, 0.6], [1.5, 0.5], [2.5, 6], [3.6, 6]] }, cam: { type: 'side', rider: attacker, dist: 90, fov: 26, ahead: 0, sign: -1, drift: 0.12, push: -0.03 },
    cues: [
      { type: 'punch', at: 0.0, dur: 1.4, text: 'ATTACK', px: 200, sub: `${Math.round(best30.w)} W FOR 30 SECONDS` },
      { type: 'rider', at: 1.5, dur: 'end', rider: attacker },
    ] });
  seg({ id: 'attack-ahead', kind: '3d', dur: 2.6, focus: attacker, labels: 'names',
    time: { t: tAttack + 8, speed: [[0, 2], [2.6, 6]] }, cam: { type: 'ahead', rider: attacker, dist: 380, fov: 15, push: -0.06, swing: 'auto' },
    cues: [{ type: 'event', at: 0.2, dur: 2.3, kicker: `KM ${km(model.distance(attacker, tAttack))} · ${clock(tAttack)}`, head: `${name(attacker)} attacks`, sub: `takes the lead from ${name(attacked)}`, rider: attacker }] });
  seg({ id: 'chase', kind: '3d', dur: 2.6, focus: chaser, labels: 'names',
    time: { t: tAttack + 28, speed: [[0, 4], [2.6, 10]] }, cam: { type: 'chase', rider: chaser, dist: 80, phi: 1.3, ahead: 60, fov: 36, swing: 'auto' },
    cues: [{ type: 'rider', at: 0.1, dur: 'end', rider: chaser }, { type: 'punch', at: 0.9, dur: 1.5, text: `${chaserHr} BPM`, px: 120, y: portrait ? 0.62 : 0.66, color: '#ff4d5a', sub: `${name(chaser)} in the red` }] });
  const c86 = clipInfo('IMG_7786.MOV'), c87 = clipInfo('IMG_7787.MOV');
  seg({ id: 'wheel', kind: 'clip', file: 'IMG_7786.MOV', dur: 2.0, src: { s: 0.6, speed: 1 }, enter: { type: 'zoom', frames: 8 }, twin: { type: 'chase', rider: chaser, dist: 70, phi: 1.3, ahead: 40, fov: 38 },
    cues: [stamp('IMG_7786.MOV')] });
  seg({ id: 'pass-profile', kind: 'clip', file: 'IMG_7787.MOV', dur: 3.6, src: { s: 16.7, at: 2.2, speed: [[0, 1], [1.6, 1], [2.0, 0.45], [3.6, 0.45]] }, twin: twin('IMG_7787.MOV'), audio: 0.2,
    cues: [stamp('IMG_7787.MOV')] });
  seg({ id: 'gap-heli', kind: '3d', dur: 2.4, focus: attacker, labels: 'all',
    time: { t: c87.raceT0 + 60, speed: [[0, 40], [2.8, 40]] }, cam: { type: 'heli', rider: attacker, group: true, reach: 400, radius: 900, phi: 0.55, spin: 0.04, theta: -0.4, fov: 34 },
    cues: [{ type: 'standings', at: 0.2, dur: 'end', top: 3, title: 'THE GAP' }, { type: 'profile', at: 0.2, dur: 'end', focus: attacker }] });

  // ===== ACT 5 · THE SUMMIT: the winner on data alone, then everyone the phones caught ===============
  seg({ id: 'finish', kind: '3d', dur: 3.4, snap: 'hit', focus: winner, labels: 'names', enter: { type: 'dip', frames: 8 },
    time: { t: tWin, at: 2.0, speed: [[0, 4], [1.2, 1], [2.0, 0.5], [3.4, 0.5]] }, cam: { type: 'chase', rider: winner, dist: 110, phi: 1.3, ahead: 45, lift: 10, fov: 30, push: -0.03 },
    cues: [{ type: 'punch', at: 2.0, dur: 1.4, text: clock(tWin), px: 230, sub: `${name(winner)} wins` }] });
  seg({ id: 'second', kind: '3d', dur: 1.8, focus: second, labels: 'names', enter: { type: 'flash', frames: 6 },
    time: { t: riders[second].finish, at: 1.0, speed: 1 }, cam: { type: 'chase', rider: second, dist: 100, phi: 1.3, ahead: 45, lift: 10, fov: 30 },
    cues: [{ type: 'event', at: 0.2, dur: 1.6, kicker: 'SECOND', head: `${name(second)} ${plus(second)}`, rider: second }] });
  // Each finisher the phone caught at the col: the caption comes up just before they pass the camera.
  const arrive = (id, file, s0, dur, rider, more = {}) => {
    const c = clipInfo(file), sight = c.sightings?.find(x => x.rider === riders[rider].id);
    seg({ id, kind: 'clip', file, dur, src: { s: s0, speed: 1 }, twin: twin(file), enter: more.enter, audio: more.audio,
      cues: [stamp(file, { place: 'THE COL' }), { type: 'finisher', rider, at: Math.max(0.1, (sight?.at ?? s0) - s0 - 1.0), dur: 'end' }] });
  };
  arrive('col-3', 'IMG_7792.MOV', 1.4, 2.4, third, { enter: { type: 'flash', frames: 6 } });
  arrive('col-4', 'IMG_7793.MOV', 15.4, 2.4, R('krzys'), { audio: 0.7 });
  arrive('col-5', 'IMG_7794.MOV', 8.9, 2.5, R('el-lobo'));
  const c95 = clipInfo('IMG_7795.MOV');
  const lastTwo = (c95.sightings ?? []).map(s => R(s.rider));
  const apart = lastTwo.length === 2 ? Math.round(Math.abs(riders[lastTwo[1]].finish - riders[lastTwo[0]].finish)) : 0;
  seg({ id: 'col-last', kind: 'clip', file: 'IMG_7795.MOV', dur: 3.8, src: { s: 0.0, speed: 1 }, twin: twin('IMG_7795.MOV'), audio: 0.6,
    cues: [stamp('IMG_7795.MOV', { place: 'THE COL' }),
      ...(lastTwo.length === 2 ? [
        { type: 'finisher', rider: lastTwo[0], at: 0.1, dur: 1.8 },
        { type: 'finisher', rider: lastTwo[1], at: 1.9, dur: 'end', sub: `${plus(lastTwo[1])}  ·  ${apart} S BEHIND ${name(lastTwo[0]).toUpperCase()}` },
      ] : [])] });

  // ===== ACT 6 · FINALE: results, the gap chart, the end card ======================================
  seg({ id: 'results', kind: '3d', dur: 3.8, snap: 'bar', focus: winner, labels: 'none', enter: { type: 'fade', frames: 12 }, dim: 0.62,
    time: { t: duration, speed: 0 }, cam: { type: 'orbit', d: len, radius: 700, phi: 0.95, theta: 2.2, spin: 0.05, fov: 40 },
    cues: [{ type: 'results', at: 0.2, dur: 'end' }] });
  seg({ id: 'gaps', kind: '3d', dur: 4.0, focus: winner, labels: 'none', dim: 0.62,
    time: { t: duration, speed: 0 }, cam: { type: 'overview', d: len * 0.5, radius: 7000, phi: 0.95, theta: 0.4, spin: 0.025, fov: 40 },
    cues: [{ type: 'gaps', at: 0.15, dur: 'end' }] });
  seg({ id: 'selfie', kind: 'clip', file: 'VMGY3907.MP4', dur: 1.8, src: { s: 0.6, speed: 1 }, enter: { type: 'flash', frames: 6 }, twin: null, fit: portrait ? 'cover' : 'blur', audio: 0.6 });
  seg({ id: 'end', kind: '3d', dur: 3.4, enter: { type: 'fade', frames: 12 }, labels: 'none', focus: null, dim: 0.72,
    time: { t: duration, speed: 0 }, cam: { type: 'overview', d: len * 0.5, radius: 7600, phi: 0.92, theta: 0.55, spin: 0.03, fov: 40 },
    cues: [{ type: 'end', at: 0.1, dur: 'end', credits: [
      ...(credits.music ? [credits.music] : []),
      'Aerial imagery © IGN / PNOA, CC BY 4.0 · Elevation: Mapzen / AWS Terrain Tiles',
      'Road © OpenStreetMap contributors (ODbL) · Ride data: the riders\' own GPS, power and heart rate',
    ] }] });

  const spans = [
    { type: 'bug', from: 'start-3d', to: 'gap-heli', skip: ['caimari', 'sign', 'gorge', 'roadside', 'wall', 'wheel', 'pass-profile'] },
    { type: 'profile', from: 'heli-early', to: 'heli-early' },
  ];
  return { segments: S, spans, facts: { attacker, attacked, chaser, winner, tAttack, tWin, best30, chaserHr } };
}

const WORDS = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE'];
export function ordinal(n) { return n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] ?? 'th'); }
function localTime(epoch, offset) {
  const sign = offset?.[0] === '-' ? -1 : 1, mins = offset ? sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3, 5))) : 0;
  const d = new Date((epoch + mins * 60) * 1000);
  return [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map(v => String(v).padStart(2, '0')).join(':');
}

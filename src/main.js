import './style.css';
import { interpolate, timeAtDistance, telemetryAt, standings, formatClock, formatGap } from './race.js';
import { elevationProfile, climbStats, gradeAt, gradeColor } from './profile.js';
import { parseState, serializeState, SPEEDS, CAMERAS } from './state.js';
import { loadRace } from './data/source.js';
import { renderProfile, createCharts } from './charts.js';

const $ = id => document.getElementById(id);
const app = $('app');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

boot().catch(error => {
  console.error(error);
  $('load-msg').textContent = error.message || 'Something went wrong. Please reload.';
  app.dataset.phase = 'error';
});

async function fetchWithProgress(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Terrain could not load. Please reload.');
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !total) return response.json();
  const reader = response.body.getReader(), chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); received += value.length;
    onProgress(Math.min(1, received / total));
  }
  return JSON.parse(new TextDecoder().decode(await new Blob(chunks).arrayBuffer()));
}

async function boot() {
  const bar = $('load-bar');
  let progress = 0.05;
  const setProgress = p => { progress = Math.max(progress, p); bar.style.transform = `scaleX(${progress})`; };
  setProgress(0.08);
  const worldModule = import('./world.js');
  const [terrain, race] = await Promise.all([
    fetchWithProgress('/terrain.json', p => setProgress(0.08 + p * 0.8)),
    loadRace(),
  ]);
  setProgress(0.9);
  if (Math.abs(race.distanceM - terrain.route.at(-1)[3]) > 1) throw new Error('Race distance does not match this climb.');

  // ---- race model ---------------------------------------------------------
  const riders = race.riders.map((r, i) => ({ ...r, index: i, letter: String.fromCharCode(65 + i), finish: r.samples.at(-1).t }));
  const duration = Math.max(...riders.map(r => r.finish));
  const route = terrain.route, len = route.at(-1)[3];
  const stats = climbStats(route), profile = elevationProfile(route);
  const distanceAt = (i, t) => interpolate(riders[i].samples, t, 'd');

  const initial = parseState(location.search, { riderIds: riders.map(r => r.id), duration });
  let time = initial.t, speed = initial.speed, playing = false, finishedShown = false;
  let selected = Math.max(0, riders.findIndex(r => r.id === initial.rider));
  let camMode = initial.cam;

  // ---- static text --------------------------------------------------------
  const km = (stats.length / 1000).toFixed(1);
  $('meta').textContent = `${km} km · +${Math.round(stats.top - stats.start)} m · ${stats.avgGrade.toFixed(1)}% avg`;
  $('intro-meta').textContent = `${km} km · ${Math.round(stats.start)} → ${Math.round(stats.top)} m · ${riders.length} riders`;
  $('badge-text').textContent = race.simulated ? 'Simulated' : 'Recorded';
  if (!race.simulated) $('sim-note').textContent = 'Recorded telemetry; missing sensor values are shown as —.';
  $('duration').textContent = '/ ' + formatClock(duration);
  const scrub = $('scrub');
  scrub.max = String(Math.ceil(duration));
  $('speed').textContent = speed + '×';

  // ---- standings board ------------------------------------------------------
  const board = $('board');
  const rows = riders.map((r, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<button style="--c:${r.color}"><span class="rank"></span><b class="letter">${r.letter}</b><span class="nm"></span><span class="gap"></span><span class="sens"></span><i class="prog"><i></i></i></button>`;
    li.querySelector('.nm').textContent = r.name;
    li.querySelector('button').addEventListener('click', () => { select(i); if (camMode === 'overview' || camMode === 'free') setCam('follow'); });
    board.append(li);
    return { li, rank: li.querySelector('.rank'), gap: li.querySelector('.gap'), sens: li.querySelector('.sens'), prog: li.querySelector('.prog i'), btn: li.querySelector('button') };
  });

  // ---- 3D world ------------------------------------------------------------
  let world = null;
  try {
    const { createWorld } = await worldModule;
    world = await createWorld({ container: $('stage'), labels: $('labels'), terrain, race: { ...race, riders }, onSelect: i => { select(i); if (camMode !== 'pov') setCam('follow'); } });
    world.onModeChange(mode => { camMode = mode; syncCams(); pushState(); });
    await Promise.race([world.ready, new Promise(r => setTimeout(r, 6000))]);
  } catch (error) { console.error(error); world = null; } // no WebGL: the HUD still works over a still image
  if (!world) {
    const img = new Image();
    img.src = terrain.texture; img.alt = 'Aerial imagery of the climb'; img.className = 'fallback';
    $('stage').prepend(img);
    $('cams').hidden = true;
    toast('3D needs WebGL — showing the race standings only.');
  }
  setProgress(1);

  // ---- controls ---------------------------------------------------------------
  function select(i) {
    selected = i;
    world?.select(i);
    app.style.setProperty('--rider', riders[i].color);
    charts.show(riders[i]);
    $('t-name').textContent = riders[i].name;
    updateUi(true);
    pushState(true);
  }
  function setCam(mode) {
    if (!world || !CAMERAS.includes(mode)) return;
    camMode = mode;
    world.setMode(mode);
    syncCams();
    pushState(true);
  }
  function syncCams() {
    for (const b of $('cams').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.cam === camMode));
  }
  function setPlaying(on) {
    if (on && time >= duration) { time = 0; finishedShown = false; }
    playing = on;
    app.classList.toggle('playing', on);
    $('play').setAttribute('aria-label', on ? 'Pause' : 'Play');
    if (!on) pushState(true);
  }
  function seek(t) {
    time = Math.max(0, Math.min(duration, t));
    if (time < duration) finishedShown = false;
    updateUi(true);
    pushState();
  }
  $('cams').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setCam(b.dataset.cam); });
  $('play').addEventListener('click', () => setPlaying(!playing));
  $('speed').addEventListener('click', () => {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    $('speed').textContent = speed + '×';
    pushState(true);
  });
  scrub.addEventListener('input', () => seek(+scrub.value));
  $('share').addEventListener('click', async () => {
    pushState(true);
    const url = location.href;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: document.title, url });
      else { await navigator.clipboard.writeText(url); toast('Link copied — it opens at this moment.'); }
    } catch (error) { if (error?.name !== 'AbortError') toast(url); }
  });
  $('replay').addEventListener('click', () => { $('podium').hidden = true; setPlaying(true); });
  $('podium-close').addEventListener('click', () => { $('podium').hidden = true; });
  addEventListener('keydown', e => {
    if (e.target.closest('input,select,textarea') && e.key !== ' ') return;
    if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === 'ArrowRight') seek(time + 15);
    else if (e.key === 'ArrowLeft') seek(time - 15);
    else if (e.key === ']') select((selected + 1) % riders.length);
    else if (e.key === '[') select((selected + riders.length - 1) % riders.length);
    else if (/^[1-4]$/.test(e.key)) setCam(['follow', 'pov', 'overview', 'free'][e.key - 1]);
  });

  const profileChart = renderProfile($('profile'), profile, len, riders, d => seek(timeAtDistance(riders[selected].samples, d)));
  const charts = createCharts([$('c-watts'), $('c-hr'), $('c-speed')], duration);

  // ---- bottom sheet -------------------------------------------------------------
  const sheet = $('sheet');
  const desktop = matchMedia('(min-width: 960px)');
  let snap = 'peek', sheetY = 0, dragStart = null;
  function snapHeights() {
    const top = sheet.getBoundingClientRect().top - sheetY;
    const peek = $('board').previousElementSibling.getBoundingClientRect().top - sheetY - top;
    const half = $('board').getBoundingClientRect().bottom - sheetY - top + 14;
    return { peek, half: Math.min(half, sheet.offsetHeight), full: sheet.offsetHeight };
  }
  function placeSheet(y, animate = true) {
    sheetY = Math.max(0, y);
    sheet.style.transition = animate ? '' : 'none';
    sheet.style.transform = desktop.matches ? '' : `translate3d(0,${sheetY}px,0)`;
    app.style.setProperty('--sheet-visible', desktop.matches ? '0px' : `${sheet.offsetHeight - sheetY}px`);
  }
  function setSnap(name, animate = true) {
    snap = name;
    sheet.dataset.snap = name;
    world?.setInsetRight(desktop.matches ? innerWidth - sheet.offsetLeft : 0);
    if (desktop.matches) return placeSheet(0, false);
    const h = snapHeights();
    placeSheet(sheet.offsetHeight - h[name], animate);
  }
  const grabZone = [$('grab'), $('transport')];
  for (const el of grabZone) {
    el.addEventListener('pointerdown', e => {
      if (desktop.matches || e.target.closest('button')) return;
      dragStart = { y: e.clientY, sheetY, t: performance.now(), moved: false };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', e => {
      if (!dragStart) return;
      const dy = e.clientY - dragStart.y;
      if (Math.abs(dy) > 4) dragStart.moved = true;
      placeSheet(dragStart.sheetY + dy, false);
    });
    el.addEventListener('pointerup', e => {
      if (!dragStart) return;
      const { y, moved, t } = dragStart, dy = e.clientY - y, v = dy / Math.max(1, performance.now() - t);
      dragStart = null;
      const h = snapHeights(), visible = sheet.offsetHeight - sheetY;
      if (!moved) return setSnap(snap === 'peek' ? 'half' : 'peek');
      const order = ['peek', 'half', 'full'];
      let target = order.reduce((best, n) => Math.abs(h[n] - visible) < Math.abs(h[best] - visible) ? n : best, 'peek');
      if (Math.abs(v) > 0.5) target = order[Math.max(0, Math.min(2, order.indexOf(snap) + (v < 0 ? 1 : -1)))];
      setSnap(target);
    });
    el.addEventListener('pointercancel', () => { dragStart = null; setSnap(snap); });
  }
  new ResizeObserver(() => { profileChart.resize(); charts.resize(); setSnap(snap, false); }).observe(sheet);
  desktop.addEventListener('change', () => setSnap(snap, false));

  // ---- URL state -----------------------------------------------------------------
  let lastPush = 0;
  function pushState(force = false) {
    const now = performance.now();
    if (!force && now - lastPush < 1000) return;
    lastPush = now;
    history.replaceState(null, '', serializeState({ t: time, rider: riders[selected].id, cam: camMode, speed }));
  }

  // ---- HUD -------------------------------------------------------------------------
  let lastUi = 0;
  const text = (id, v) => { const el = $(id); if (el.textContent !== v) el.textContent = v; };
  function updateUi(force = false) {
    const now = performance.now();
    if (!force && now - lastUi < 100) return;
    lastUi = now;
    const table = standings(riders, time), byIndex = [];
    for (const row of table) byIndex[row.index] = row;
    table.forEach((row, n) => {
      const r = rows[row.index], tel = telemetryAt(riders[row.index].samples, time);
      r.li.style.order = n;
      r.btn.setAttribute('aria-pressed', String(row.index === selected));
      r.rank.textContent = row.rank;
      r.gap.textContent = row.finished ? (row.rank === 1 ? formatClock(row.finish) : formatGap(row.gap)) : row.rank === 1 ? 'Leader' : formatGap(row.gap);
      r.sens.textContent = row.finished ? 'Finished' : `${tel.watts ?? '—'} W · ${tel.hr ?? '—'} bpm`;
      r.prog.style.transform = `scaleX(${row.d / len})`;
    });
    const me = byIndex[selected], tel = telemetryAt(riders[selected].samples, time), rider = riders[selected];
    text('f-letter', rider.letter);
    text('f-name', rider.name);
    text('f-pos', me.finished ? `Finished P${me.rank} · ${formatClock(me.finish)}` : me.rank === 1 ? 'P1 · Leading' : `P${me.rank} · ${formatGap(me.gap)}`);
    text('f-togo', ((len - me.d) / 1000).toFixed(2));
    text('f-w', me.finished ? '—' : String(tel.watts ?? '—'));
    text('f-hr', me.finished ? '—' : String(tel.hr ?? '—'));
    text('f-v', me.finished || tel.speed == null ? '—' : tel.speed.toFixed(1));
    const grade = gradeAt(route, me.d);
    text('f-g', grade.toFixed(1));
    $('f-g').style.color = `rgb(${gradeColor(grade)})`;
    text('clock', formatClock(time));
    scrub.value = String(Math.round(time));
    scrub.style.setProperty('--p', (time / duration * 100).toFixed(2) + '%');
    profileChart.update(riders.map((_, i) => distanceAt(i, time)), selected);
    charts.cursor(time);
    app.classList.toggle('finished', me.finished);
  }

  // ---- intro ---------------------------------------------------------------------------
  const captions = [
    [0.0, ''],
    [0.27, `The summit · ${Math.round(stats.top)} m`],
    [0.45, `${km} km at ${stats.avgGrade.toFixed(1)}% · max ${stats.maxGrade.toFixed(0)}%`],
    [0.72, `Caimari · ${Math.round(stats.start)} m · ${riders.length} riders on the line`],
  ];
  function runIntro() {
    world.setInsetRight(0); // the desktop panel is hidden during the intro
    app.dataset.phase = 'intro';
    let shown = -1;
    world.startIntro({
      duration: 12500,
      onProgress: u => {
        const i = captions.findLastIndex(([at]) => u >= at);
        if (i !== shown) { shown = i; const cap = $('intro-cap'); cap.classList.remove('in'); void cap.offsetWidth; cap.textContent = captions[i][1]; if (captions[i][1]) cap.classList.add('in'); }
        app.classList.toggle('intro-titled', u < 0.24);
      },
      onDone: () => {
        app.dataset.phase = 'race';
        app.classList.remove('intro-titled');
        setSnap(snap, false);
        camMode = 'follow'; syncCams();
        const go = $('go'); go.classList.add('in'); setTimeout(() => go.classList.remove('in'), 1100);
        setTimeout(() => setPlaying(true), 450);
      },
    });
    $('skip').onclick = () => world.skipIntro();
  }

  // ---- loop ------------------------------------------------------------------------------
  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      time = Math.min(duration, time + dt * speed);
      if (time >= duration) {
        setPlaying(false);
        if (!finishedShown) { finishedShown = true; showPodium(); }
      }
      pushState();
    }
    if (world) world.frame({ time, distances: riders.map((_, i) => distanceAt(i, time)), playing, rate: speed });
    updateUi();
    requestAnimationFrame(tick);
  }

  function showPodium() {
    const table = standings(riders, duration);
    $('podium-list').innerHTML = '';
    for (const row of table) {
      const r = riders[row.index], li = document.createElement('li');
      li.style.setProperty('--c', r.color);
      li.innerHTML = `<span class="pos"></span><b class="letter">${r.letter}</b><span class="nm"></span><strong></strong><span class="gap"></span>`;
      li.querySelector('.pos').textContent = row.rank;
      li.querySelector('.nm').textContent = r.name;
      li.querySelector('strong').textContent = formatClock(row.finish);
      li.querySelector('.gap').textContent = row.rank === 1 ? 'Winner' : formatGap(row.gap);
      $('podium-list').append(li);
    }
    $('podium').hidden = false;
  }

  // ---- go ------------------------------------------------------------------------------------
  select(selected);
  syncCams();
  setSnap('peek', false);
  updateUi(true);
  requestAnimationFrame(tick);
  app.dataset.phase = 'ready';
  await new Promise(r => setTimeout(r, 250));
  if (!world) { app.dataset.phase = 'race'; return; }
  if (initial.shared || reducedMotion) {
    world.setMode(camMode);
    syncCams();
    app.dataset.phase = 'race';
    if (!initial.shared) setPlaying(true);
  } else runIntro();
}

let toastTimer = 0;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('in');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('in'), 2600);
}

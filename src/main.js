import './style.css';
import { interpolate, timeAtDistance, telemetryAt, standings, formatClock, formatGap } from './race.js';
import { elevationProfile, climbStats, gradeAt, gradeColor } from './profile.js';
import { parseState, serializeState, SPEEDS, CAMERAS } from './state.js';
import { loadRace } from './data/source.js';
import { renderProfile, createCharts } from './charts.js';
import { detectMoments } from './moments.js';
import { createScrubber } from './scrubber.js';

const $ = id => document.getElementById(id);
const app = $('app');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PRESETS = CAMERAS.slice(0, 3); // follow, overview, side; 'free' is where gestures leave the camera
const CHIP_RIDERS = 5; // the rider row shows the top five (plus the selected rider)

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
  const moments = detectMoments(riders, route);

  const initial = parseState(location.search, { riderIds: riders.map(r => r.id), duration });
  let time = initial.t, speed = initial.speed, playing = false, finishedShown = false;
  let selected = Math.max(0, riders.findIndex(r => r.id === initial.rider));
  let camMode = initial.cam, lastPreset = PRESETS.includes(camMode) ? camMode : 'follow';

  // ---- static text --------------------------------------------------------
  const km = (stats.length / 1000).toFixed(1);
  $('meta').textContent = `${km} km · +${Math.round(stats.top - stats.start)} m · ${stats.avgGrade.toFixed(1)}% avg`;
  $('intro-meta').textContent = `${km} km · ${Math.round(stats.start)} → ${Math.round(stats.top)} m · ${riders.length} riders`;
  $('badge-text').textContent = race.simulated ? 'Simulated' : 'Recorded';
  if (!race.simulated) $('sim-note').textContent = 'Recorded telemetry; missing sensor values are shown as —.';
  $('duration').textContent = '/ ' + formatClock(duration);
  $('speed').textContent = speed + '×';

  // ---- standings board and rider chips ---------------------------------------
  const board = $('board'), chips = $('chips');
  const rows = riders.map((r, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<button style="--c:${r.color}"><span class="rank"></span><b class="letter">${r.letter}</b><span class="nm"></span><span class="gap"></span><span class="sens"></span><i class="prog"><i></i></i></button>`;
    li.querySelector('.nm').textContent = r.name;
    li.querySelector('button').addEventListener('click', () => followRider(i));
    board.append(li);
    const chip = document.createElement('button');
    chip.className = 'chip-rider';
    chip.style.setProperty('--c', r.color);
    chip.innerHTML = `<b class="letter">${r.letter}</b><span class="nm"></span><span class="gap"></span>`;
    chip.querySelector('.nm').textContent = r.name;
    chip.addEventListener('click', () => tapRider(i));
    chips.append(chip);
    return { li, rank: li.querySelector('.rank'), gap: li.querySelector('.gap'), sens: li.querySelector('.sens'), prog: li.querySelector('.prog i'), btn: li.querySelector('button'), chip, chipGap: chip.querySelector('.gap') };
  });
  $('chip-all').addEventListener('click', () => setCam('overview'));

  // ---- 3D world ------------------------------------------------------------
  // Callbacks from the world can fire while it is still loading; they wait until the HUD is wired (`live`).
  let world = null, live = false;
  try {
    const { createWorld } = await worldModule;
    world = await createWorld({ container: $('stage'), labels: $('labels'), terrain, race: { ...race, riders }, onSelect: i => live && tapRider(i) });
    world.onModeChange(mode => { if (!live) return; camMode = mode; syncCams(); pushState(); });
    world.onHint(showHint);
    // ?debug exposes the live state to the browser tests (tests/e2e).
    if (new URLSearchParams(location.search).has('debug')) window.wielkiWyscig = { world, get time() { return time; }, get cam() { return camMode; } };
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
  const chasing = () => camMode === 'follow' || camMode === 'side';
  function select(i) {
    selected = i;
    world?.select(i);
    app.style.setProperty('--rider', riders[i].color);
    charts.show(riders[i]);
    $('t-name').textContent = riders[i].name;
    updateUi(true);
    pushState(true);
  }
  // From the standings or the scrubber: watch this rider, keeping a rider camera if one is on.
  function followRider(i) {
    select(i);
    if (!chasing()) setCam('follow');
    syncCams();
  }
  // A rider chip or 3D label: the first tap follows, a second tap lets the camera go (free orbit).
  function tapRider(i) {
    if (i === selected && chasing()) setCam('free');
    else followRider(i);
  }
  function setCam(mode) {
    if (!world || !CAMERAS.includes(mode)) return;
    if (world.introRunning) world.skipIntro(); // ends the intro through its onDone, so the race still starts
    camMode = mode;
    if (PRESETS.includes(mode)) lastPreset = mode;
    world.setMode(mode);
    syncCams();
    pushState(true);
  }
  function resetView() { setCam(camMode === 'free' ? lastPreset : camMode); }
  function syncCams() {
    for (const b of $('cams').querySelectorAll('button[data-cam]')) b.setAttribute('aria-pressed', String(b.dataset.cam === camMode));
    $('chip-all').setAttribute('aria-pressed', String(camMode === 'overview'));
    rows.forEach((r, i) => {
      // Followed: filled in the rider's colour. Selected but released: an outline only.
      r.chip.setAttribute('aria-pressed', String(i === selected && chasing()));
      r.chip.classList.toggle('selected', i === selected);
    });
  }
  function setPlaying(on) {
    if (on && time >= duration) { time = 0; finishedShown = false; }
    playing = on;
    app.classList.toggle('playing', on);
    $('play').setAttribute('aria-label', on ? 'Pause' : 'Play');
    if (!on) pushState(true);
    wake();
  }
  function seek(t) {
    time = Math.max(0, Math.min(duration, t));
    if (time < duration) finishedShown = false;
    updateUi(true);
    pushState();
  }
  $('cams').addEventListener('click', e => { const b = e.target.closest('button[data-cam]'); if (b) setCam(b.dataset.cam); });
  $('reset').addEventListener('click', resetView);
  $('play').addEventListener('click', () => setPlaying(!playing));
  $('speed').addEventListener('click', () => {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    $('speed').textContent = speed + '×';
    pushState(true);
  });
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
    if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === 'ArrowRight') seek(time + 15);
    else if (e.key === 'ArrowLeft') seek(time - 15);
    else if (e.key === ']') select((selected + 1) % riders.length);
    else if (e.key === '[') select((selected + riders.length - 1) % riders.length);
    else if (/^[1-3]$/.test(e.key)) setCam(PRESETS[e.key - 1]);
    else if (e.key === 'r' || e.key === '0') resetView();
  });

  // Scrubbing pauses the race under the finger and resumes it on release.
  let resumeAfterDrag = false;
  const scrubber = createScrubber($('scrub'), {
    duration, moments, onSeek: seek, clock: formatClock,
    describe: t => {
      const lead = standings(riders, t)[0];
      return { time: formatClock(t), place: `km ${(lead.d / 1000).toFixed(1)} · ${riders[lead.index].name} ${lead.finished ? 'wins' : 'leads'}` };
    },
    onDrag: on => {
      if (on) { resumeAfterDrag = playing; if (playing) setPlaying(false); }
      else if (resumeAfterDrag && time < duration) setPlaying(true); // dragged to the end: stay there, do not restart
    },
  });

  const profileChart = renderProfile($('profile'), profile, len, riders, d => seek(timeAtDistance(riders[selected].samples, d)));
  const charts = createCharts([$('c-watts'), $('c-hr'), $('c-speed')], duration);

  // ---- sheet and dock ------------------------------------------------------------
  // On a phone the page scrolls: the sheet sits in the flow under a spacer as tall as
  // the map, and CSS scroll snapping holds it at peek, half (standings) and full.
  const sheet = $('sheet'), dock = $('dock'), root = document.documentElement;
  const desktop = matchMedia('(min-width: 960px)');
  const safeTop = () => parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
  function snapPoints() {
    const top = sheet.getBoundingClientRect().top + scrollY;
    const half = $('board').getBoundingClientRect().bottom + scrollY - (innerHeight - dock.offsetHeight) + 8;
    return { peek: 0, half: Math.max(0, Math.min(half, top)), full: Math.max(0, top - safeTop()) };
  }
  $('grab').addEventListener('click', () => {
    if (desktop.matches) return;
    const s = snapPoints(), y = scrollY;
    const target = y < s.half - 10 ? s.half : y < s.full - 10 ? s.full : s.peek;
    scrollTo({ top: target, behavior: reducedMotion ? 'auto' : 'smooth' });
  });
  function measure() {
    // The dock height is measured with every row showing; while reading, rows fold away without moving the sheet.
    if (!app.classList.contains('reading')) root.style.setProperty('--dock-h', `${dock.offsetHeight}px`);
    root.style.setProperty('--peek-h', `${$('peek').offsetHeight}px`);
    world?.setInsetRight(desktop.matches ? innerWidth - sheet.getBoundingClientRect().left : 0);
  }
  function onScroll() {
    const reading = !desktop.matches && sheet.getBoundingClientRect().top < innerHeight * 0.42;
    if (reading !== app.classList.contains('reading')) app.classList.toggle('reading', reading);
    $('grab').setAttribute('aria-expanded', String(!desktop.matches && scrollY > 40));
  }
  addEventListener('scroll', () => { onScroll(); wake(); }, { passive: true });
  new ResizeObserver(() => { profileChart.resize(); charts.resize(); measure(); }).observe(sheet);
  new ResizeObserver(measure).observe(dock);
  desktop.addEventListener('change', () => { measure(); onScroll(); });

  // ---- chrome: hide after 3 s idle while playing, any tap brings it back --------------
  let idleTimer = 0, swallowClick = false;
  function wake() {
    if (app.classList.contains('chrome-off')) app.classList.remove('chrome-off');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const busy = !playing || app.dataset.phase !== 'race' || scrollY > 8 || !$('podium').hidden || scrubber.dragging || document.querySelector('.dock :focus-visible');
      if (!busy) app.classList.add('chrome-off');
    }, 3000);
  }
  addEventListener('pointerdown', () => {
    // The tap that brings the chrome back does nothing else.
    if (app.classList.contains('chrome-off')) { swallowClick = true; setTimeout(() => { swallowClick = false; }, 600); }
    wake();
  }, true);
  addEventListener('click', e => { if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); } }, true);
  addEventListener('pointermove', e => { if (e.pointerType === 'mouse') wake(); }, { passive: true });
  addEventListener('keydown', wake, true);

  let hintTimer = 0;
  function showHint() {
    if (!live || app.dataset.phase !== 'race') return;
    $('hint').classList.add('in');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => $('hint').classList.remove('in'), 1500);
  }

  // ---- URL state -----------------------------------------------------------------
  let lastPush = 0;
  function pushState(force = false) {
    // Nothing is written before the race phase: a boot-time ?t=0 would make every reload look like a shared link and skip the intro.
    if (app.dataset.phase !== 'race') return;
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
      const gap = row.finished ? (row.rank === 1 ? formatClock(row.finish) : formatGap(row.gap)) : row.rank === 1 ? 'Leader' : formatGap(row.gap);
      r.li.style.order = n;
      r.btn.setAttribute('aria-pressed', String(row.index === selected));
      r.rank.textContent = row.rank;
      r.gap.textContent = gap;
      r.sens.textContent = row.finished ? 'Finished' : `${tel.watts ?? '—'} W · ${tel.hr ?? '—'} bpm`;
      r.prog.style.transform = `scaleX(${row.d / len})`;
      r.chip.style.order = n;
      r.chip.hidden = n >= CHIP_RIDERS && row.index !== selected;
      r.chipGap.textContent = row.rank === 1 ? (row.finished ? 'Won' : 'Lead') : formatGap(row.gap);
    });
    const me = byIndex[selected], tel = telemetryAt(riders[selected].samples, time), rider = riders[selected];
    const lead = table[0], leader = riders[lead.index], second = table[1];
    text('p-letter', leader.letter);
    $('p-letter').style.setProperty('--c', leader.color);
    text('p-name', leader.name);
    text('p-note', lead.finished ? `wins · ${formatClock(lead.finish)}` : 'leads');
    if (lead.index !== selected) {
      text('p-gap', formatGap(me.gap));
      text('p-gap-note', `${rider.name} · P${me.rank}`);
    } else {
      text('p-gap', second ? formatGap(second.gap) : '—');
      text('p-gap-note', second ? `to ${riders[second.index].name}` : '');
    }
    text('f-pos', me.finished ? `Finished P${me.rank} · ${formatClock(me.finish)}` : me.rank === 1 ? 'P1 · Leading' : `P${me.rank} · ${formatGap(me.gap)}`);
    text('f-togo', ((len - me.d) / 1000).toFixed(2));
    text('f-w', me.finished ? '—' : String(tel.watts ?? '—'));
    text('f-hr', me.finished ? '—' : String(tel.hr ?? '—'));
    text('f-v', me.finished || tel.speed == null ? '—' : tel.speed.toFixed(1));
    const grade = gradeAt(route, me.d, 200); // same smoothing scale as the profile colours
    text('f-g', grade.toFixed(1));
    $('f-g').style.color = `rgb(${gradeColor(grade)})`;
    text('clock', formatClock(time));
    scrubber.update(time);
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
        scrollTo(0, 0);
        measure();
        camMode = 'follow'; lastPreset = 'follow'; syncCams();
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
  live = true;
  select(selected);
  syncCams();
  measure();
  updateUi(true);
  requestAnimationFrame(tick);
  app.dataset.phase = 'ready';
  await new Promise(r => setTimeout(r, 250));
  if (!world) { app.dataset.phase = 'race'; return; }
  if (initial.shared || reducedMotion) {
    world.setMode(camMode);
    syncCams();
    app.dataset.phase = 'race';
    measure();
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

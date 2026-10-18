import './style.css';
import { interpolate, timeAtDistance, telemetryAt, standings, formatClock, formatGap } from './race.js';
import { elevationProfile, climbStats, gradeAt, gradeColor } from './profile.js';
import { parseState, serializeState, SPEEDS, CAMERAS } from './state.js';
import { loadRace } from './data/source.js';
import { renderProfile, createCharts } from './charts.js';
import { deriveEvents } from './events.js';
import { createDirector } from './director.js';
import { drawCard } from './card.js';
import mediaData from '../data/media.json';

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
  $('load-msg').textContent = 'Building the 3D climb…'; // the slow part on a phone: meshes and shaders, with no bytes to count
  if (Math.abs(race.distanceM - terrain.route.at(-1)[3]) > 1) throw new Error('Race distance does not match this climb.');

  // ---- race model ---------------------------------------------------------
  const riders = race.riders.map((r, i) => ({ ...r, index: i, letter: String.fromCharCode(65 + i), finish: r.samples.at(-1).t }));
  const duration = Math.max(...riders.map(r => r.finish));
  const route = terrain.route, len = route.at(-1)[3];
  const stats = climbStats(route), profile = elevationProfile(route);
  const distanceAt = (i, t) => interpolate(riders[i].samples, t, 'd');

  const summit = route.reduce((best, p) => p[2] > best[2] ? p : best);
  const events = deriveEvents(riders, { summitD: summit[3] });
  // Media moments (data/media.json): a clip filmed where a rider passed road point d, timed by that rider.
  const moments = mediaData.map(m => ({ ...m, rider: riders.findIndex(r => r.id === m.riderId) }))
    .filter(m => m.rider >= 0)
    .map(m => ({ ...m, t: timeAtDistance(riders[m.rider].samples, m.d) }));

  const initial = parseState(location.search, { riderIds: riders.map(r => r.id), duration });
  let time = initial.t, speed = initial.speed, playing = false, finishedShown = false;
  let selected = Math.max(0, riders.findIndex(r => r.id === initial.rider));
  let camMode = initial.cam === 'auto' ? 'follow' : initial.cam, auto = false;
  // The TV director's moves: race events, plus the video moments (cut there before the clip pops up).
  const director = createDirector({
    targets: [...events, ...moments.map(m => ({ t: m.t, type: 'media', rider: m.rider, score: 60 }))].sort((a, b) => a.t - b.t),
    order: t => standings(riders, t).map(row => row.index),
    names: riders.map(r => r.name),
  });

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
    li.querySelector('button').addEventListener('click', () => followRider(i));
    board.append(li);
    return { li, rank: li.querySelector('.rank'), gap: li.querySelector('.gap'), sens: li.querySelector('.sens'), prog: li.querySelector('.prog i'), btn: li.querySelector('button') };
  });

  // ---- race events: ticks on the scrubber and a list behind one button ------
  const EVENT_ICONS = {
    pass: '<path d="M5 6.5 10.5 12 5 17.5M12.5 6.5 18 12l-5.5 5.5"/>',
    lead: '<path d="M4 18.5h16M5 15.5 3.5 7l5 3.5L12 4l3.5 6.5 5-3.5-1.5 8.5z"/>',
    summit: '<path d="M2.5 20 9.5 8l4 6.5 2.5-3.5 5.5 9z"/>',
    finish: '<path d="M6 21V3.5M6 4h11.5l-2.5 4.25 2.5 4.25H6"/>',
    media: '<rect x="3" y="7" width="12.5" height="10" rx="2"/><path d="m15.5 10.5 5-3v9l-5-3z"/>',
  };
  for (const e of [...events, ...moments.map(m => ({ t: m.t, type: 'media' }))]) {
    const tick = document.createElement('i');
    tick.className = e.type;
    tick.style.left = (e.t / duration * 100).toFixed(2) + '%';
    $('ticks').append(tick);
  }
  const listed = [...events, ...moments.map(m => ({ t: m.t, type: 'media', rider: m.rider, text: m.caption, moment: m }))].sort((a, b) => a.t - b.t);
  const eventItems = listed.map(e => {
    const li = document.createElement('li'), r = riders[e.rider];
    li.innerHTML = `<button style="--c:${r.color}" data-t="${e.t}"><time>${formatClock(e.t)}</time><svg viewBox="0 0 24 24" aria-hidden="true">${EVENT_ICONS[e.type]}</svg><span></span></button>`;
    li.querySelector('span').textContent = e.text;
    li.querySelector('button').addEventListener('click', () => e.moment ? openMoment(e.moment) : jumpTo(e));
    $('events-list').append(li);
    return li;
  });
  const resultsItem = document.createElement('li');
  resultsItem.innerHTML = '<button class="results"><time></time><span aria-hidden="true">🏁</span><span>Results</span></button>';
  resultsItem.querySelector('button').addEventListener('click', () => { closeEvents(); showCard(); });
  $('events-list').append(resultsItem);
  const eventsBox = $('events'), eventsBtn = $('events-btn');
  function openEvents() {
    eventItems.forEach((li, k) => li.classList.toggle('past', listed[k].t < time));
    eventsBox.hidden = false;
    eventsBtn.setAttribute('aria-expanded', 'true');
    const card = $('events-card');
    if (desktop.matches) { // a popover under the button, inside the panel
      const b = eventsBtn.getBoundingClientRect();
      card.style.top = `${b.bottom + 8}px`;
      card.style.right = `${innerWidth - sheet.getBoundingClientRect().right + 18}px`;
    } else card.style.top = card.style.right = '';
    (eventItems.find(li => !li.classList.contains('past')) ?? eventItems.at(-1))?.scrollIntoView({ block: 'nearest' });
  }
  function closeEvents() {
    eventsBox.hidden = true;
    eventsBtn.setAttribute('aria-expanded', 'false');
  }
  // Start a little before the move (about two seconds of playback at the current speed), on the rider who made it.
  function jumpTo(e) {
    closeEvents();
    autoOff();
    followRider(e.rider);
    seek(e.t - Math.min(60, Math.max(5, 2 * speed)));
    pushState(true);
    setPlaying(true);
  }
  eventsBtn.addEventListener('click', () => eventsBox.hidden ? openEvents() : closeEvents());

  // ---- media moments: a muted picture-in-picture as the rider passes, a full-screen clip on tap ----
  const pip = $('pip'), pipVideo = pip.querySelector('video'), clip = $('clip'), clipVideo = clip.querySelector('video');
  let pipMoment = null, resumeAfterClip = false;
  function showPip(m) {
    pipMoment = m;
    pipVideo.src = m.src; pipVideo.poster = m.poster ?? '';
    pip.hidden = false;
    requestAnimationFrame(() => pip.classList.add('in'));
    app.classList.add('pip-on');
    pipVideo.play().catch(() => hidePip());
  }
  function hidePip() {
    if (pip.hidden) return;
    pip.classList.remove('in');
    app.classList.remove('pip-on');
    pipVideo.pause();
    setTimeout(() => { if (!pip.classList.contains('in')) pip.hidden = true; }, 400);
  }
  pipVideo.addEventListener('ended', hidePip);
  pip.addEventListener('click', () => pipMoment && openMoment(pipMoment));
  // Seek to the moment, follow its rider, and play the clip full screen; the race waits behind it.
  function openMoment(m) {
    closeEvents();
    hidePip();
    autoOff();
    followRider(m.rider);
    seek(m.t);
    resumeAfterClip = playing;
    setPlaying(false);
    clipVideo.src = m.src; clipVideo.poster = m.poster ?? '';
    clipVideo.muted = true;
    clip.querySelector('.clip-cap').textContent = m.caption;
    clip.classList.remove('sound');
    clip.hidden = false;
    if (!reducedMotion) clipVideo.play().catch(() => {});
  }
  function closeClip() {
    clip.hidden = true;
    clipVideo.pause();
    if (resumeAfterClip) setPlaying(true);
  }
  // Tap the clip: sound on (and play again once it has ended).
  clipVideo.addEventListener('click', () => {
    clipVideo.muted = false;
    clip.classList.add('sound');
    if (clipVideo.paused) clipVideo.play().catch(() => {});
  });
  $('clip-close').addEventListener('click', closeClip);
  clip.addEventListener('click', e => { if (e.target === clip) closeClip(); });
  eventsBox.addEventListener('click', e => { if (e.target === eventsBox) closeEvents(); });

  // ---- 3D world ------------------------------------------------------------
  // Callbacks from the world can fire while it is still loading; they wait until the HUD is wired (`live`).
  let world = null, live = false, pageDrag = null;
  try {
    const { createWorld } = await worldModule;
    world = await createWorld({ container: $('stage'), labels: $('labels'), terrain, race: { ...race, riders }, onSelect: i => live && followRider(i), onPageDrag: (phase, y) => live && pageDrag?.(phase, y), keepOut: document.querySelector('.top') });
    world.onModeChange(mode => { if (!live) return; camMode = mode; syncCams(); pushState(); });
    world.onUserCamera(() => live && autoOff());
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
  // Picking a rider from the board or a 3D label: keep a rider camera, leave the map views for Follow.
  function followRider(i) {
    autoOff();
    select(i);
    if (camMode !== 'pov') setCam('follow');
  }
  function setCam(mode) {
    if (mode === 'auto') return setAuto(!auto);
    if (!world || !CAMERAS.includes(mode)) return;
    if (world.introRunning) world.skipIntro(); // ends the intro through its onDone, so the race still starts
    auto = false;
    camMode = mode;
    world.setMode(mode);
    syncCams();
    pushState(true);
  }
  function syncCams() {
    for (const b of $('cams').querySelectorAll('button')) b.setAttribute('aria-pressed', String(auto ? b.dataset.cam === 'auto' : b.dataset.cam === camMode));
  }
  // ---- auto "TV" camera: the director cuts; any manual camera or rider choice hands control back ----
  function setAuto(on) {
    if (!world || on === auto) return;
    auto = on;
    world.setCinematic(on);
    app.classList.toggle('auto', on); // letterbox bars while the director has the camera
    if (on) cutTo(director.start(time, performance.now() / 1000, speed));
    syncCams();
    pushState(true);
  }
  function autoOff() { if (auto) setAuto(false); }
  function cutTo(c) {
    select(c.rider);
    if (world.setShot(c.shot, c.side) === 'cut') dip();
    camMode = CAMERAS.includes(c.shot) ? c.shot : 'follow';
    syncCams();
    if (c.caption) lowerThird(c.caption, riders[c.rider].color);
  }
  // A long move is a cut, not a fly-by: dip the picture so it reads as one.
  function dip() {
    const stage = $('stage');
    stage.classList.remove('dip'); void stage.offsetWidth;
    stage.classList.add('dip');
  }
  let capTimer = 0;
  function lowerThird(message, color) {
    const el = $('tv-cap');
    el.style.setProperty('--cap', color);
    el.classList.remove('in'); void el.offsetWidth;
    el.textContent = message;
    el.classList.add('in');
    clearTimeout(capTimer);
    capTimer = setTimeout(() => el.classList.remove('in'), 3200);
  }
  function setPlaying(on) {
    if (on && time >= duration) { time = 0; finishedShown = false; }
    playing = on;
    app.classList.toggle('playing', on);
    coverCard(); // the card is slim while playing, full when paused
    $('play').setAttribute('aria-label', on ? 'Pause' : 'Play');
    if (!on) pushState(true);
  }
  function seek(t) {
    time = Math.max(0, Math.min(duration, t));
    if (pipMoment && Math.abs(time - pipMoment.t) > 120) hidePip();
    if (time < duration) finishedShown = false;
    updateUi(true);
    pushState();
  }
  const desktop = matchMedia('(min-width: 960px)');
  // Next / previous rider by current race position, wrapping, so every rider is a few swipes away.
  const focus = $('focus');
  function stepRider(dir) {
    const order = standings(riders, time).map(row => row.index);
    select(order[(order.indexOf(selected) + dir + order.length) % order.length]);
    focus.classList.remove('slide-next', 'slide-prev');
    void focus.offsetWidth;
    focus.classList.add(dir > 0 ? 'slide-next' : 'slide-prev');
  }
  $('f-prev').addEventListener('click', () => { autoOff(); stepRider(-1); });
  $('f-next').addEventListener('click', () => { autoOff(); stepRider(1); });
  let swipe = null;
  focus.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    swipe = { x: e.clientX, y: e.clientY };
    focus.setPointerCapture(e.pointerId);
  });
  focus.addEventListener('pointermove', e => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x;
    if (Math.abs(dx) > Math.abs(e.clientY - swipe.y)) focus.style.setProperty('--drag', `${dx * 0.4}px`);
  });
  const endSwipe = e => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    swipe = null;
    focus.style.removeProperty('--drag');
    if (e.type === 'pointerup' && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { autoOff(); stepRider(dx < 0 ? 1 : -1); }
    // A tap keeps the full card open during playback (phones show a slim one while playing); a second tap lets it go.
    else if (e.type === 'pointerup' && Math.abs(dx) < 8 && Math.abs(dy) < 8 && !desktop.matches) { focus.classList.toggle('pinned'); coverCard(); }
  };
  focus.addEventListener('pointerup', endSwipe);
  focus.addEventListener('pointercancel', endSwipe);
  // Phones show one camera button, the current shot; tapping it opens the others. Desktop shows them all.
  const cams = $('cams');
  const closeCams = () => { cams.classList.remove('open'); cams.querySelector('[aria-pressed="true"]')?.setAttribute('aria-expanded', 'false'); };
  cams.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (!desktop.matches && !cams.classList.contains('open') && b.getAttribute('aria-pressed') === 'true') {
      cams.classList.add('open'); b.setAttribute('aria-expanded', 'true');
      return;
    }
    const wasOpen = cams.classList.contains('open');
    closeCams();
    if (wasOpen && b.getAttribute('aria-pressed') === 'true') return; // closing the menu on the current shot changes nothing (and keeps Auto on)
    setCam(b.dataset.cam);
  });
  document.addEventListener('pointerdown', e => { if (cams.classList.contains('open') && !cams.contains(e.target)) closeCams(); });
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
  $('replay').addEventListener('click', () => { resumeAfterCard = false; closeCard(); seek(0); setPlaying(true); });
  $('card-close').addEventListener('click', closeCard);
  $('card').addEventListener('click', e => { if (e.target === $('card')) closeCard(); });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('card').hidden) return closeCard();
    if (e.key === 'Escape' && !clip.hidden) return closeClip();
    if (e.key === 'Escape' && !eventsBox.hidden) return closeEvents();
    if (e.target.closest('input,select,textarea') && e.key !== ' ') return;
    if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === 'ArrowRight') seek(time + 15);
    else if (e.key === 'ArrowLeft') seek(time - 15);
    else if (e.key === ']') { autoOff(); stepRider(1); }
    else if (e.key === '[') { autoOff(); stepRider(-1); }
    else if (e.key === 'a') setAuto(!auto);
    else if (/^[1-4]$/.test(e.key)) setCam(CAMERAS[e.key - 1]);
  });

  const profileChart = renderProfile($('profile'), profile, len, riders, d => seek(timeAtDistance(riders[selected].samples, d)));
  const charts = createCharts([$('c-watts'), $('c-hr'), $('c-speed')], duration, seek);

  // ---- bottom sheet -------------------------------------------------------------
  const sheet = $('sheet');
  let snap = 'peek', sheetY = 0, dragStart = null;
  function snapHeights() {
    const top = sheet.getBoundingClientRect().top - sheetY;
    // Peek shows the player bar only: it ends under the scrubber, above the sheet's own bottom padding.
    const peek = sheet.querySelector('.scrub-wrap').getBoundingClientRect().bottom - sheetY - top + parseFloat(getComputedStyle(sheet).paddingBottom);
    const half = $('board').getBoundingClientRect().bottom - sheetY - top + 14;
    return { peek, half: Math.min(half, sheet.offsetHeight), full: sheet.offsetHeight };
  }
  // A tall sheet (seven riders fill "half" too) slides over the rider card: the card steps aside rather than show cut in half.
  function coverCard(cardBottom = focus.getBoundingClientRect().bottom) {
    app.classList.toggle('sheet-over-card', !desktop.matches && innerHeight - (sheet.offsetHeight - sheetY) < cardBottom - 12);
  }
  function placeSheet(y, animate = true) {
    const cardBottom = focus.getBoundingClientRect().bottom; // read before the writes below: one layout per drag move
    sheetY = Math.max(0, y);
    sheet.style.transition = animate ? '' : 'none';
    sheet.style.transform = desktop.matches ? '' : `translate3d(0,${sheetY}px,0)`;
    app.style.setProperty('--sheet-visible', desktop.matches ? '0px' : `${sheet.offsetHeight - sheetY}px`);
    coverCard(cardBottom);
  }
  function setSnap(name, animate = true) {
    snap = name;
    sheet.dataset.snap = name;
    world?.setInsetRight(desktop.matches ? innerWidth - sheet.offsetLeft : 0);
    if (desktop.matches) return placeSheet(0, false);
    // Below full the content does not scroll: back to its top, where the half snap expects the standings.
    if (name !== 'full') $('sheet-body').scrollTop = 0;
    const h = snapHeights();
    // On a short screen the standings do not fit in half: the sheet opens full, where the content scrolls.
    if (name === 'half' && h.half >= h.full - 1) snap = sheet.dataset.snap = name = 'full';
    placeSheet(sheet.offsetHeight - h[name], animate);
  }
  function dragBegin(y) { dragStart = { y, sheetY, t: performance.now(), moved: false }; }
  function dragMove(y) {
    if (!dragStart) return;
    const dy = y - dragStart.y;
    if (Math.abs(dy) > 4) dragStart.moved = true;
    placeSheet(dragStart.sheetY + dy, false);
  }
  function dragCancel() { if (dragStart) { dragStart = null; setSnap(snap); } }
  function dragEnd(y) {
    if (!dragStart) return;
    const { moved, t } = dragStart, dy = y - dragStart.y, v = dy / Math.max(1, performance.now() - t);
    dragStart = null;
    const h = snapHeights(), visible = sheet.offsetHeight - sheetY;
    if (!moved) return setSnap(snap === 'peek' ? 'half' : 'peek');
    const order = h.half >= h.full - 1 ? ['peek', 'full'] : ['peek', 'half', 'full'];
    let target = order.reduce((best, n) => Math.abs(h[n] - visible) < Math.abs(h[best] - visible) ? n : best, 'peek');
    if (Math.abs(v) > 0.5) target = order[Math.max(0, Math.min(order.length - 1, order.indexOf(snap) + (v < 0 ? 1 : -1)))];
    setSnap(target);
  }
  const grabZone = [$('grab'), $('transport')];
  for (const el of grabZone) {
    el.addEventListener('pointerdown', e => {
      if (desktop.matches || e.target.closest('button')) return;
      dragBegin(e.clientY);
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', e => dragMove(e.clientY));
    el.addEventListener('pointerup', e => dragEnd(e.clientY));
    el.addEventListener('pointercancel', dragCancel);
  }
  // The content under the scrubber scrolls natively once the sheet is fully open. Until then its bottom is off
  // screen, so a swipe there moves the sheet; when full, so does a pull down from the top of the content.
  // The direction of the first move decides: after it, a browser no longer lets a scroll be cancelled.
  const body = $('sheet-body');
  let bodyTouch = null;
  body.addEventListener('touchstart', e => {
    const own = desktop.matches || e.touches.length !== 1 || e.target.closest('.profile svg');
    bodyTouch = own ? null : { y: e.touches[0].clientY, mode: null };
  }, { passive: true });
  body.addEventListener('touchmove', e => {
    if (!bodyTouch) return;
    const y = e.touches[0].clientY, dy = y - bodyTouch.y;
    if (!bodyTouch.mode) {
      if (!dy) return;
      bodyTouch.mode = snap !== 'full' || (dy > 0 && body.scrollTop <= 0) ? 'sheet' : 'scroll';
      if (bodyTouch.mode === 'sheet') dragBegin(bodyTouch.y);
    }
    if (bodyTouch.mode !== 'sheet') return;
    e.preventDefault();
    dragMove(y);
  }, { passive: false });
  body.addEventListener('touchend', e => {
    if (bodyTouch?.mode === 'sheet') dragStart?.moved ? dragEnd(e.changedTouches[0].clientY) : dragCancel();
    bodyTouch = null;
  });
  body.addEventListener('touchcancel', () => { if (bodyTouch?.mode === 'sheet') dragCancel(); bodyTouch = null; });
  // A one-finger vertical swipe over the map moves the sheet, as if the page scrolled.
  // Returns false on 'start' when there is no sheet to move, so the swipe stays with the map.
  pageDrag = (phase, y) => {
    if (phase === 'start') {
      if (desktop.matches || app.dataset.phase !== 'race') return false;
      dragBegin(y);
      hintOnce('ww-two-fingers', 'Two fingers to move the map');
    } else if (phase === 'move') dragMove(y);
    else if (phase === 'end') dragEnd(y);
    else dragCancel();
    return true;
  };
  new ResizeObserver(() => { profileChart.resize(); charts.resize(); setSnap(snap, false); }).observe(sheet);
  desktop.addEventListener('change', () => setSnap(snap, false));

  // ---- URL state -----------------------------------------------------------------
  let lastPush = 0;
  function pushState(force = false) {
    // Nothing is written before the race phase: a boot-time ?t=0 would make every reload look like a shared link and skip the intro.
    if (app.dataset.phase !== 'race') return;
    const now = performance.now();
    if (!force && now - lastPush < 1000) return;
    lastPush = now;
    history.replaceState(null, '', serializeState({ t: time, rider: riders[selected].id, cam: auto ? 'auto' : camMode, speed }));
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
    const grade = gradeAt(route, me.d, 200); // same smoothing scale as the profile colours
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
        setAuto(true); // first open: the TV camera directs until the viewer takes over
        const go = $('go'); go.classList.add('in'); setTimeout(() => go.classList.remove('in'), 1100);
        setTimeout(() => setPlaying(true), 450);
      },
    });
    $('skip').onclick = () => world.skipIntro();
  }

  // ---- loop ------------------------------------------------------------------------------
  let last = performance.now(), slowmo = 1;
  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // The TV director slows time around the big moments; eased, so it never jolts.
    const wantSlow = auto && playing && !reducedMotion ? director.timeScale(time, speed) : 1;
    slowmo += (wantSlow - slowmo) * Math.min(1, dt * 2.5);
    if (playing) {
      const from = time;
      time = Math.min(duration, time + dt * speed * slowmo);
      const crossed = events.findLast(e => e.t > from && e.t <= time);
      if (crossed) auto ? lowerThird(crossed.text, riders[crossed.rider].color) : toast(crossed.text, 2500);
      const met = moments.findLast(m => m.t > from && m.t <= time);
      if (met && !reducedMotion && clip.hidden) showPip(met);
      if (time >= duration) {
        setPlaying(false);
        if (!finishedShown) { finishedShown = true; showCard(); }
      }
      pushState();
      if (auto && playing && !world.introRunning) { const c = director.update({ time, speed, now: now / 1000 }); if (c) cutTo(c); }
    }
    if (world) world.frame({ time, distances: riders.map((_, i) => distanceAt(i, time)), playing, rate: speed * slowmo });
    updateUi();
    requestAnimationFrame(tick);
  }

  // ---- end-of-race card: one canvas, shown here and saved or shared as the same PNG ----
  const card = $('card'), cardCanvas = $('card-canvas');
  let cardFile = null, resumeAfterCard = false;
  async function showCard() {
    if (!card.hidden) return;
    resumeAfterCard = playing;
    setPlaying(false);
    card.hidden = false;
    cardFile = null;
    $('card-share').hidden = true;
    await drawCard(cardCanvas, { riders, events, route, profile, stats, title: race.title ?? 'Coll de sa Batalla', place: 'Mallorca' });
    // The file is made now, so Share runs inside the tap (Safari drops a share started after an await).
    const blob = await new Promise(r => cardCanvas.toBlob(r, 'image/png'));
    if (!blob) return;
    cardFile = new File([blob], 'wielki-wyscig-results.png', { type: 'image/png' });
    $('card-share').hidden = !(navigator.canShare?.({ files: [cardFile] }));
  }
  function closeCard() {
    card.hidden = true;
    if (resumeAfterCard) setPlaying(true);
    resumeAfterCard = false;
  }
  $('card-save').addEventListener('click', () => {
    if (!cardFile) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(cardFile); a.download = cardFile.name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  $('card-share').addEventListener('click', () => {
    if (!cardFile) return;
    navigator.share({ files: [cardFile], title: document.title, text: `${riders[standings(riders, duration)[0].index].name} wins · ${location.origin}` })
      .catch(error => { if (error?.name !== 'AbortError') toast('Sharing failed — use Save image.'); });
  });

  // ---- go ------------------------------------------------------------------------------------
  for (const m of moments) world?.addPin({ d: m.d, label: `Video: ${m.caption}`, onClick: () => live && openMoment(m) });
  live = true;
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
    if (initial.cam === 'auto') setAuto(true);
    app.dataset.phase = 'race';
    if (!initial.shared) setPlaying(true);
  } else runIntro();
}

let toastTimer = 0;
function toast(message, ms = 2600) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('in');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('in'), ms);
}
// A hint shown once per browser; storage can be blocked, then it shows once per visit.
const hinted = new Set();
function hintOnce(key, message) {
  if (hinted.has(key)) return;
  hinted.add(key);
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch {}
  toast(message);
}

// Phone controls, driven through a real browser with real touch input.
//   npm run build && npx vite preview --port 4173 &
//   npm run e2e -- http://localhost:4173 [screenshot-dir]
// Replays the scroll trap Tom hit on 17.10 ("difficult to scroll down on mobile, you
// move the map instead"), then taps every control at 390×844, 844×390 and 1440×900.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:4173';
const shots = process.argv[3];
if (shots) mkdirSync(shots, { recursive: true });
const URL_ = `${base}/?t=900&cam=follow&debug`;
let failures = 0;
const results = [];
async function check(name, fn) {
  try { await fn(); results.push(`ok   ${name}`); } catch (error) { failures++; results.push(`FAIL ${name}\n     ${error.message.split('\n').join('\n     ')}`); }
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function open(viewport, touch) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch });
  const page = await ctx.newPage();
  page.on('pageerror', e => { failures++; results.push(`FAIL page error: ${e.message}`); });
  await page.goto(URL_);
  await page.waitForFunction(() => document.getElementById('app').dataset.phase === 'race' && window.wielkiWyscig, null, { timeout: 60000 });
  await settle(page);
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp };
}
const camera = page => page.evaluate(() => window.wielkiWyscig.world.cameraPosition);
const moved = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// Wait until the camera has eased onto its pose (it glides for a few seconds after a change).
// Sampled per rendered frame, not per wall-clock tick: a software-rendered frame can take longer than a tick.
async function settle(page) {
  const sample = () => page.evaluate(async () => {
    for (let i = 0; i < 8; i++) await new Promise(r => requestAnimationFrame(r));
    return window.wielkiWyscig.world.cameraPosition;
  });
  let last = await sample(), still = 0;
  for (let i = 0; i < 80; i++) {
    const now = await sample();
    still = moved(last, now) < 0.05 ? still + 1 : 0;
    if (still >= 3) return now;
    last = now;
  }
  throw new Error('camera never settled');
}
const query = page => page.evaluate(() => Object.fromEntries(new URLSearchParams(location.search)));
const shot = (page, name) => shots && page.screenshot({ path: `${shots}/${name}.jpg`, quality: 80 });

// Touch gestures through the browser's input pipeline, so scrolling and touch-action are real.
async function touch(cdp, paths, { steps = 12, hold = 16 } = {}) {
  const at = k => paths.map(([[x0, y0], [x1, y1]], id) => ({ x: x0 + (x1 - x0) * k / steps, y: y0 + (y1 - y0) * k / steps, id }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let k = 1; k <= steps; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(k) });
    await new Promise(r => setTimeout(r, hold));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tap(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  assert.ok(box, `${selector} is on screen`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(250);
}

// ---- phone, portrait ---------------------------------------------------------------
{
  const { ctx, page, cdp } = await open({ width: 390, height: 844 }, true);
  await shot(page, 'phone-portrait');

  await check('scroll trap: one-finger swipe up over the map scrolls the page, the camera stays', async () => {
    const before = await settle(page), y0 = await page.evaluate(() => scrollY);
    await page.evaluate(() => {
      const hint = document.getElementById('hint');
      new MutationObserver(() => { if (hint.classList.contains('in')) window.hintSeen = true; }).observe(hint, { attributes: true });
    });
    await touch(cdp, [[[200, 520], [200, 160]]]);
    await page.waitForTimeout(700);
    const y1 = await page.evaluate(() => scrollY), after = await camera(page);
    assert.equal(y0, 0);
    assert.ok(y1 > 150, `scrollY went ${y0} → ${y1}`);
    assert.ok(moved(before, after) < 0.5, `camera moved ${moved(before, after).toFixed(2)} m`);
  });
  await check('the first one-finger drag shows "Use two fingers to move the map"', async () => {
    assert.ok(await page.evaluate(() => window.hintSeen === true));
  });
  await shot(page, 'phone-scrolled');
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(500);

  await check('one-finger sideways drag over the map: camera stays, hint shows', async () => {
    await page.waitForTimeout(1600);
    const before = await settle(page);
    await touch(cdp, [[[80, 400], [320, 410]]]);
    await page.waitForTimeout(150);
    const hint = await page.evaluate(() => document.getElementById('hint').classList.contains('in'));
    await shot(page, 'phone-hint');
    await page.waitForTimeout(500);
    { const d = moved(before, await camera(page)); assert.ok(d < 0.5, `camera moved ${d.toFixed(2)} m`); }
    assert.ok(hint, 'hint not shown');
  });

  let home, gestured;
  await check('two-finger pinch moves the map and leaves the page still', async () => {
    home = await settle(page);
    const y0 = await page.evaluate(() => scrollY);
    await touch(cdp, [[[150, 380], [90, 300]], [[240, 460], [300, 540]]]);
    gestured = await settle(page);
    assert.ok(moved(home, gestured) > 5, `camera moved only ${moved(home, gestured).toFixed(2)} m`);
    assert.equal(await page.evaluate(() => scrollY), y0, 'page scrolled');
  });
  await check('two fingers landing 120 ms apart (a real hand) still pinch the map, not the page', async () => {
    const start = await settle(page);
    const one = { x: 150, y: 380, id: 0 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [one] });
    await page.waitForTimeout(120);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [one, { x: 240, y: 460, id: 1 }] });
    for (let k = 1; k <= 12; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150 - 5 * k, y: 380 - 7 * k, id: 0 }, { x: 240 + 5 * k, y: 460 + 7 * k, id: 1 }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = await settle(page);
    assert.equal(await page.evaluate(() => scrollY), 0, 'page scrolled');
    assert.ok(moved(start, after) > 5, `camera moved only ${moved(start, after).toFixed(2)} m`);
    gestured = after;
  });
  await check('two-finger vertical drag (orbit) does not scroll the page', async () => {
    await touch(cdp, [[[140, 300], [140, 450]], [[250, 300], [250, 450]]]);
    const after = await settle(page);
    assert.equal(await page.evaluate(() => scrollY), 0, 'page scrolled');
    assert.ok(moved(gestured, after) > 1, 'camera did not orbit');
  });
  await check('reset view: one tap brings the camera back to the preset pose', async () => {
    await tap(page, '#reset');
    const back = await settle(page);
    assert.ok(moved(home, back) < 2, `camera ${moved(home, back).toFixed(1)} m from its preset pose`);
    assert.equal((await query(page)).cam, 'follow');
  });

  await check('thumb zone: dock controls in the bottom 35%, the sheet handle just above', async () => {
    const tops = await page.evaluate(() => [...document.querySelectorAll('.dock button, .dock [role=slider], .peek button')]
      .filter(e => e.offsetParent).map(e => [e.id || e.className, e.getBoundingClientRect().top, !!e.closest('.peek')]));
    for (const [name, top, peek] of tops) assert.ok(top >= 844 * (peek ? 0.6 : 0.65), `${name} top at ${Math.round(top)} px (${(top / 844 * 100).toFixed(0)}%)`);
  });
  await check('tap targets ≥ 48 px with ≥ 8 px between neighbours', async () => {
    const rows = await page.evaluate(() => ['.cams', '.chips', '.transport', '.peek'].map(sel =>
      [...document.querySelectorAll(`${sel} > button, ${sel} > div > button`)].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.className, r.left, r.right, r.width, r.height]; })
        .sort((a, b) => a[1] - b[1])));
    for (const row of rows) row.forEach(([name, left, , w, h], i) => {
      assert.ok(w >= 48 && h >= 48, `${name} is ${w}×${h}`);
      if (i) assert.ok(left - row[i - 1][2] >= 8, `${name} is ${(left - row[i - 1][2]).toFixed(1)} px from its neighbour`);
    });
    const scrub = await page.locator('#scrub').boundingBox();
    assert.ok(scrub.height >= 48 && scrub.width >= 300, `scrubber ${scrub.width}×${scrub.height}`);
  });

  await check('play / pause', async () => {
    await tap(page, '#play');
    assert.ok(await page.evaluate(() => document.getElementById('app').classList.contains('playing')));
    await tap(page, '#play');
    assert.ok(!(await page.evaluate(() => document.getElementById('app').classList.contains('playing'))));
  });
  await check('speed cycles 1× → 4× → 16×', async () => {
    const seen = [];
    for (let i = 0; i < 3; i++) { await tap(page, '#speed'); seen.push(await page.locator('#speed').textContent()); }
    assert.deepEqual(seen, ['1×', '4×', '16×']);
  });
  await check('camera presets: Overview, Side, Follow', async () => {
    for (const cam of ['overview', 'side', 'follow']) {
      await tap(page, `.cams [data-cam=${cam}]`);
      assert.equal(await page.locator(`.cams [data-cam=${cam}]`).getAttribute('aria-pressed'), 'true');
      assert.equal((await query(page)).cam, cam);
      if (cam === 'side') { await page.waitForTimeout(2200); await shot(page, 'phone-side'); }
    }
  });
  await check('rider chip: tap follows, tap again releases to free orbit, All = overview', async () => {
    // Any rider other than the selected one: the suite runs on whatever race /api/race serves.
    const other = await page.evaluate(() => { const w = window.wielkiWyscig; return w.riders.find((_, i) => i !== w.selected); });
    const chipA = `.chip-rider:has(.letter:text-is("${other.letter}"))`;
    await tap(page, chipA);
    assert.equal((await query(page)).r, other.id);
    assert.equal(await page.locator(chipA).getAttribute('aria-pressed'), 'true');
    await shot(page, 'phone-chip-follow');
    await tap(page, chipA);
    assert.equal((await query(page)).cam, 'free');
    assert.equal(await page.locator(chipA).getAttribute('aria-pressed'), 'false');
    assert.ok(await page.locator(chipA).evaluate(e => e.classList.contains('selected')), 'released chip keeps its ring');
    await tap(page, '#chip-all');
    assert.equal((await query(page)).cam, 'overview');
    await tap(page, '.cams [data-cam=follow]');
  });
  await check('scrubber: tap near a race moment lands on it', async () => {
    // The marker with the most room around it, so the tap can only mean that one.
    const m = await page.evaluate(() => {
      const marks = [...document.querySelectorAll('.moment')].map((el, i) => { const r = el.getBoundingClientRect(); return { i, x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      const room = k => Math.min(...marks.filter(o => o !== k).map(o => Math.abs(o.x - k.x)));
      const best = marks.reduce((a, b) => room(b) > room(a) ? b : a);
      return { x: best.x + 9, y: best.y, t: window.wielkiWyscig.moments[best.i].t };
    });
    await page.touchscreen.tap(m.x, m.y);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.wielkiWyscig.time), m.t);
  });
  await check('scrubber: sideways drag seeks with a time/km bubble and snaps to the finish', async () => {
    const box = await page.locator('#scrub').boundingBox(), y = box.y + box.height / 2;
    const finishX = await page.evaluate(() => { const r = document.querySelector('.moment[data-kind=finish]').getBoundingClientRect(); return r.left + r.width / 2; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 40, y }] });
    for (let k = 1; k <= 10; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 40 + (finishX + 6 - box.x - 40) * k / 10, y }] });
      await page.waitForTimeout(20);
    }
    const bubble = await page.evaluate(() => ({ on: document.getElementById('scrub').classList.contains('show-bubble'), text: document.getElementById('bubble').innerText }));
    await shot(page, 'phone-scrub-drag');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
    assert.ok(bubble.on, 'bubble hidden while dragging');
    assert.match(bubble.text, /^\d+:\d\d\n.{4,}/);
    assert.equal(await page.evaluate(() => window.wielkiWyscig.time), await page.evaluate(() => window.wielkiWyscig.moments.at(-1).t), 'did not snap to the finish');
    await page.evaluate(() => { document.getElementById('podium').hidden = true; });
  });
  await check('vertical swipe that starts on the scrubber scrolls the page, does not seek', async () => {
    const t0 = await page.evaluate(() => window.wielkiWyscig.time), box = await page.locator('#scrub').boundingBox();
    await touch(cdp, [[[box.x + 100, box.y + 26], [box.x + 100, box.y - 300]]]);
    await page.waitForTimeout(700);
    assert.ok(await page.evaluate(() => scrollY) > 50, 'page did not scroll');
    assert.equal(await page.evaluate(() => window.wielkiWyscig.time), t0, 'the swipe seeked');
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(400);
  });
  await check('sheet: tapping the peek line steps peek → half → full → peek', async () => {
    const ys = [];
    for (let i = 0; i < 3; i++) { await tap(page, '#grab'); await page.waitForTimeout(900); ys.push(await page.evaluate(() => Math.round(scrollY))); if (i === 0) await shot(page, 'phone-sheet-half'); if (i === 1) await shot(page, 'phone-sheet-full'); }
    assert.ok(ys[0] > 100 && ys[1] > ys[0] && ys[2] === 0, `scrollY ${ys.join(' → ')}`);
  });
  await check('share gives feedback', async () => {
    await page.waitForTimeout(400);
    await tap(page, '#share');
    assert.ok(await page.evaluate(() => document.getElementById('toast').classList.contains('in') || !!navigator.share));
  });
  await check('chrome hides after 3 s of playback and one tap brings it back without side effects', async () => {
    await page.evaluate(() => scrollTo(0, 0));
    await tap(page, '#play');
    await page.waitForTimeout(3600);
    assert.ok(await page.evaluate(() => document.getElementById('app').classList.contains('chrome-off')), 'chrome still showing');
    await shot(page, 'phone-idle');
    const cam = (await query(page)).cam;
    await page.touchscreen.tap(195, 300);
    await page.waitForTimeout(300);
    assert.ok(!(await page.evaluate(() => document.getElementById('app').classList.contains('chrome-off'))), 'chrome did not come back');
    assert.equal((await query(page)).cam, cam);
    await tap(page, '#play');
  });
  await check('no sideways page overflow', async () => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  });
  await ctx.close();
}

// ---- phone, landscape ----------------------------------------------------------------
{
  const { ctx, page, cdp } = await open({ width: 844, height: 390 }, true);
  await shot(page, 'phone-landscape');
  await check('landscape: rail controls work (play, presets, reset, speed)', async () => {
    await tap(page, '#play');
    assert.ok(await page.evaluate(() => document.getElementById('app').classList.contains('playing')));
    await tap(page, '#play');
    for (const cam of ['overview', 'side', 'follow']) { await tap(page, `.cams [data-cam=${cam}]`); assert.equal((await query(page)).cam, cam); }
    await tap(page, '#reset');
    await tap(page, '#speed');
    assert.equal(await page.locator('#speed').textContent(), '1×');
  });
  await check('landscape: rail is a slim right column, every control ≥ 48 px and on screen', async () => {
    const boxes = await page.evaluate(() => [...document.querySelectorAll('.cams button, .transport button')].map(e => { const r = e.getBoundingClientRect(); return [e.id || e.dataset.cam, r.left, r.top, r.bottom, r.width, r.height]; }));
    for (const [name, left, top, bottom, w, h] of boxes) {
      assert.ok(left > 844 - 90, `${name} at x=${left}`);
      assert.ok(top >= 0 && bottom <= 390, `${name} ${top}–${bottom} off screen`);
      assert.ok(w >= 48 && h >= 48, `${name} ${w}×${h}`);
    }
    const sorted = boxes.sort((a, b) => a[2] - b[2]);
    sorted.forEach((b, i) => { if (i) assert.ok(b[2] - sorted[i - 1][3] >= 8, `${b[0]} overlaps ${sorted[i - 1][0]}`); });
  });
  await check('landscape: one-finger swipe scrolls the page, not the map', async () => {
    const before = await settle(page);
    await touch(cdp, [[[300, 220], [300, 40]]]);
    await page.waitForTimeout(700);
    assert.ok(await page.evaluate(() => scrollY) > 60, 'page did not scroll');
    { const d = moved(before, await camera(page)); assert.ok(d < 0.5, `camera moved ${d.toFixed(2)} m`); }
    await shot(page, 'phone-landscape-scrolled');
  });
  await ctx.close();
}

// ---- desktop ---------------------------------------------------------------------------
{
  const { ctx, page } = await open({ width: 1440, height: 900 }, false);
  await shot(page, 'desktop');
  await check('desktop: mouse drag still orbits the camera', async () => {
    const before = await camera(page);
    await page.mouse.move(400, 400); await page.mouse.down();
    await page.mouse.move(520, 380, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(600);
    assert.ok(moved(before, await camera(page)) > 5, 'camera did not move');
  });
  await check('desktop: buttons and keys work', async () => {
    // Like a person: the pointer travels to the button first, which wakes a dock that hid during playback.
    const click = async selector => {
      const box = await page.locator(selector).first().boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
      await page.waitForTimeout(400);
      await page.click(selector);
    };
    await click('#play');
    assert.ok(await page.evaluate(() => document.getElementById('app').classList.contains('playing')));
    await click('#play');
    await click('.cams [data-cam=side]');
    assert.equal((await query(page)).cam, 'side');
    await page.keyboard.press('2');
    assert.equal((await query(page)).cam, 'overview');
    const other = await page.evaluate(() => { const w = window.wielkiWyscig; return w.riders.find((_, i) => i !== w.selected); });
    await click(`.chip-rider:has(.letter:text-is("${other.letter}"))`);
    assert.equal((await query(page)).r, other.id);
    assert.equal((await query(page)).cam, 'follow');
  });
  await check('desktop: the page itself does not scroll', async () => {
    await page.mouse.move(400, 400);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => scrollY), 0);
  });
  await ctx.close();
}

await browser.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);

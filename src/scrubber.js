// The race clock as a wide scrubber with a thumb-sized handle. Drag or tap to seek;
// a bubble shows the time and place while dragging, and the race moments marked
// on the track pull the handle onto them. The track scrolls the page vertically
// (`touch-action: pan-y`), so only a sideways drag seeks.
const SNAP_DRAG = 14, SNAP_TAP = 24, PAD = 16; // px; PAD keeps the handle inside the track at both ends

export function createScrubber(el, { duration, moments, clock, describe, onSeek, onDrag }) {
  const bubble = el.querySelector('.scrub-bubble'), list = el.querySelector('.scrub-moments');
  el.setAttribute('aria-valuemax', String(Math.round(duration)));
  const marks = moments.map(m => {
    const i = document.createElement('i');
    i.className = 'moment';
    i.dataset.kind = m.kind;
    i.style.left = `calc(${PAD}px + (100% - ${2 * PAD}px) * ${m.t / duration})`;
    list.append(i);
    return i;
  });

  const geometry = () => { const r = el.getBoundingClientRect(); return { left: r.left + PAD, width: Math.max(1, r.width - 2 * PAD) }; };
  const timeAt = x => { const g = geometry(); return Math.max(0, Math.min(1, (x - g.left) / g.width)) * duration; };
  function snap(t, radius) {
    const pxPerSecond = geometry().width / duration;
    let best = null;
    for (const m of moments) {
      const dist = Math.abs(m.t - t) * pxPerSecond;
      if (dist <= radius && (!best || dist < best.dist)) best = { m, dist };
    }
    return best?.m ?? null;
  }

  let value = 0, drag = null, snapped = null, hideTimer = 0;
  function showBubble(t, moment) {
    const { time, place } = describe(t);
    bubble.querySelector('b').textContent = time;
    bubble.querySelector('span').textContent = moment ? moment.label : place;
    bubble.classList.toggle('at-moment', !!moment);
    el.classList.add('show-bubble');
    clearTimeout(hideTimer);
  }
  function hideBubble(delay = 0) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => el.classList.remove('show-bubble'), delay);
  }
  function seekTo(x, radius) {
    const raw = timeAt(x), moment = snap(raw, radius), t = moment ? moment.t : raw;
    if (moment && moment !== snapped) navigator.vibrate?.(8);
    snapped = moment;
    onSeek(t);
    showBubble(t, moment);
  }

  el.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, active: false };
    // A mouse drags at once; a finger first has to show it is going sideways, not scrolling.
    if (e.pointerType !== 'touch') { drag.active = true; el.setPointerCapture(e.pointerId); el.classList.add('dragging'); onDrag?.(true); seekTo(e.clientX, SNAP_DRAG); }
  });
  el.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    if (!drag.active) {
      if (Math.abs(e.clientX - drag.x) < 6) return;
      drag.active = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      onDrag?.(true);
    }
    seekTo(e.clientX, SNAP_DRAG);
  });
  const end = e => {
    if (!drag || drag.id !== e.pointerId) return;
    const wasActive = drag.active;
    drag = null;
    el.classList.remove('dragging');
    if (e.type === 'pointerup' && !wasActive) seekTo(e.clientX, SNAP_TAP); // a tap jumps, and a tap near a marker lands on it
    if (wasActive) onDrag?.(false);
    snapped = null;
    hideBubble(e.type === 'pointerup' ? 1100 : 0);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', e => {
    const next = e.key === 'PageDown' ? moments.find(m => m.t > value + 0.5) : e.key === 'PageUp' ? moments.findLast(m => m.t < value - 0.5) : null;
    const t = next ? next.t : e.key === 'Home' ? 0 : e.key === 'End' ? duration : null;
    if (t === null) return;
    e.preventDefault();
    onSeek(t);
    showBubble(t, next);
    hideBubble(1100);
  });

  return {
    update(t) {
      value = t;
      el.style.setProperty('--p', String(t / duration));
      el.setAttribute('aria-valuenow', String(Math.round(t)));
      const label = clock(t); // every frame: the clock only, describe() is for the bubble
      el.setAttribute('aria-valuetext', label);
      el.dataset.time = label;
      marks.forEach((mark, i) => mark.classList.toggle('passed', moments[i].t <= t));
    },
    get dragging() { return !!drag?.active; },
  };
}

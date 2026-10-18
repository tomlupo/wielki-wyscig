// SVG charts in the sheet: the elevation profile (with rider positions) and
// the selected rider's power / heart-rate / speed traces.
import { scaleLinear, line, area, extent, select, pointer } from 'd3';
import { gradeColor } from './profile.js';

export function renderProfile(svgEl, profile, len, riders, onSeek) {
  const svg = select(svgEl), h = 76, m = { l: 4, r: 4, t: 16, b: 14 };
  const [lo, hi] = extent(profile, p => p.ele);
  let x, y, dots, guide;
  const gradientId = 'grade-gradient';

  function draw() {
    const w = Math.max(200, svgEl.clientWidth || 360);
    svg.attr('viewBox', `0 0 ${w} ${h}`).selectAll('*').remove();
    x = scaleLinear().domain([0, len]).range([m.l, w - m.r]);
    y = scaleLinear().domain([lo - (hi - lo) * 0.08, hi]).range([h - m.b, m.t]);
    const grad = svg.append('defs').append('linearGradient').attr('id', gradientId).attr('x1', 0).attr('x2', 1);
    for (let i = 0; i < profile.length; i += 4) {
      const near = profile.slice(Math.max(0, i - 4), i + 5), grade = near.reduce((s, p) => s + p.grade, 0) / near.length;
      grad.append('stop').attr('offset', profile[i].d / len).attr('stop-color', `rgb(${gradeColor(grade)})`);
    }
    svg.append('path').datum(profile).attr('class', 'p-area').attr('fill', `url(#${gradientId})`)
      .attr('d', area().x(p => x(p.d)).y0(h - m.b).y1(p => y(p.ele)));
    svg.append('path').datum(profile).attr('class', 'p-line').attr('d', line().x(p => x(p.d)).y(p => y(p.ele)));
    for (let k = 1; k * 1000 < len; k++) svg.append('text').attr('class', 'p-km').attr('x', x(k * 1000)).attr('y', h - 2).text(k + (k === 1 ? ' km' : ''));
    svg.append('text').attr('class', 'p-alt').attr('x', m.l).attr('y', 10).text(`${Math.round(profile[0].ele)} m`);
    svg.append('text').attr('class', 'p-alt').attr('x', w - m.r).attr('y', 10).attr('text-anchor', 'end').text(`${Math.round(profile.at(-1).ele)} m`);
    guide = svg.append('line').attr('class', 'p-guide').attr('y1', m.t - 4).attr('y2', h - m.b);
    dots = riders.map(r => {
      const g = svg.append('g').attr('class', r.ring ? 'p-dot ring' : 'p-dot').style('--c', r.color);
      g.append('circle').attr('r', 6.5);
      return g;
    });
    svg.append('rect').attr('class', 'p-hit').attr('x', 0).attr('y', 0).attr('width', w).attr('height', h)
      .on('pointerdown pointermove', event => {
        if (event.type === 'pointermove' && !event.buttons) return;
        event.preventDefault();
        onSeek(Math.max(0, Math.min(len, x.invert(pointer(event)[0]))));
      });
  }
  const eleAt = d => {
    let i = Math.min(profile.length - 1, Math.max(0, Math.round(d / (profile[1].d - profile[0].d))));
    return profile[i].ele;
  };
  let lastDistances = riders.map(() => 0), lastSelected = 0;
  function update(distances, selected) {
    lastDistances = distances; lastSelected = selected;
    distances.forEach((d, i) => {
      dots[i].attr('transform', `translate(${x(d)},${y(eleAt(d)) - 1})`).classed('sel', i === selected);
      if (i === selected) dots[i].raise();
    });
    guide.attr('x1', x(distances[selected])).attr('x2', x(distances[selected]));
  }
  draw();
  return { update, resize() { draw(); update(lastDistances, lastSelected); } };
}

// Centred moving average over `window` seconds, skipping missing values: on a phone-sized chart
// second-by-second power is a solid band, and the trend is what reads.
export function smooth(samples, key, window = 30) {
  const out = [];
  let lo = 0, hi = 0, sum = 0, n = 0;
  for (const s of samples) {
    while (hi < samples.length && samples[hi].t <= s.t + window / 2) { const v = samples[hi++][key]; if (v != null) { sum += v; n++; } }
    while (samples[lo].t < s.t - window / 2) { const v = samples[lo++][key]; if (v != null) { sum -= v; n--; } }
    out.push({ t: s.t, v: s[key] == null || !n ? null : sum / n });
  }
  return out;
}

export function createCharts(svgs, duration, onSeek) {
  const defs = [['watts', svgs[0]], ['hr', svgs[1]], ['speed', svgs[2]]];
  let rider = null, cursors = [];
  function draw() {
    if (!rider) return;
    cursors = [];
    for (const [key, el] of defs) {
      const w = Math.max(160, el.clientWidth || 300), h = 74, m = { l: 30, r: 4, t: 6, b: 16 };
      const data = rider.samples, [a = 0, b = 1] = extent(data.filter(s => s[key] != null), s => s[key]), pad = Math.max(1, b - a) * 0.12;
      const x = scaleLinear().domain([0, duration]).range([m.l, w - m.r]);
      const y = scaleLinear().domain([Math.max(0, a - pad), b + pad]).nice(3).range([h - m.b, m.t]);
      const svg = select(el).attr('viewBox', `0 0 ${w} ${h}`);
      svg.selectAll('*').remove();
      for (const v of y.ticks(3)) {
        svg.append('line').attr('class', 'c-grid').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y(v)).attr('y2', y(v));
        svg.append('text').attr('class', 'c-tick').attr('x', m.l - 5).attr('y', y(v) + 3.5).attr('text-anchor', 'end').text(v);
      }
      for (const v of [0, duration / 2, duration]) svg.append('text').attr('class', 'c-tick').attr('x', x(v)).attr('y', h - 3).attr('text-anchor', v ? v === duration ? 'end' : 'middle' : 'start').text(Math.round(v / 60) + "'");
      const shape = line().defined(s => s[key] != null).x(s => x(s.t)).y(s => y(s[key]));
      svg.append('path').datum(data).attr('class', 'c-raw').attr('stroke', rider.color).attr('d', shape);
      const trend = line().defined(s => s.v != null).x(s => x(s.t)).y(s => y(s.v));
      svg.append('path').datum(smooth(data, key)).attr('class', 'c-line').attr('stroke', rider.color).attr('d', trend);
      const cursor = svg.append('line').attr('class', 'c-cursor').attr('y1', m.t).attr('y2', h - m.b);
      cursors.push({ cursor, x });
      // Tap or drag sideways to move the clock. A vertical drag scrolls the sheet: the browser
      // takes it over (pointercancel), so it never seeks.
      let start = null;
      const at = event => Math.max(0, Math.min(duration, x.invert(pointer(event, el)[0])));
      svg.append('rect').attr('class', 'c-hit').attr('x', 0).attr('y', 0).attr('width', w).attr('height', h)
        .on('pointerdown', event => { start = { x: event.clientX, drag: false }; })
        .on('pointermove', event => {
          if (!start || !event.buttons) return;
          if (!start.drag && Math.abs(event.clientX - start.x) < 6) return;
          start.drag = true;
          onSeek?.(at(event));
        })
        .on('pointerup', event => { if (start) onSeek?.(at(event)); start = null; })
        .on('pointercancel pointerleave', () => { start = null; });
    }
  }
  return {
    show(r) { rider = r; draw(); },
    resize: draw,
    cursor(t) { for (const { cursor, x } of cursors) cursor.attr('x1', x(t)).attr('x2', x(t)); },
  };
}

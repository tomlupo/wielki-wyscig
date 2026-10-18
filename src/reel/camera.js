// Scripted broadcast cameras for the reel. Each shot is a pure function of the race state
// at one frame (race time, every rider's road distance) and of the time into the shot, so
// any frame can be rendered on its own and a re-render is identical.
//
// World axes (world.js): x east, z south, y up, metres; riders drawn 5× life size.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const ease = {
  linear: u => u,
  inOut: u => u * u * u * (u * (u * 6 - 15) + 10), // smootherstep
  out: u => 1 - (1 - u) ** 3,
  in: u => u ** 3,
};
export { ease };

export function createCameras(world, model) {
  const { roadPoint, roadDir, elevation } = world;
  const len = model.len;
  const v = () => new THREE.Vector3();
  const tmp = v(), tmp2 = v(), sight = v();

  // A rider's position at road distance d (lane offsets ignored: ±3 m does not move a camera).
  const at = (d, out = v()) => roadPoint(Math.max(0, Math.min(len, d)), out, 1.6);
  // Road heading at d, smoothed over ±span metres so hairpins do not whip the camera.
  const heading = (d, span = 60) => { roadDir(Math.max(0, Math.min(len, d)), tmp, span); return Math.atan2(tmp.x, tmp.z); };

  // The subject: one rider, or the riders on the road within `reach` m of them (a group shot).
  function subject(spec, ctx, out = v()) {
    if (spec.d != null && spec.rider == null) return at(spec.d, out);
    const i = spec.rider, d0 = ctx.d[i];
    if (!spec.group) return at(d0, out);
    out.set(0, 0, 0);
    let n = 0;
    ctx.d.forEach((d, k) => { if (Math.abs(d - d0) <= (spec.reach ?? 250) || k === i) { out.add(at(d, tmp2)); n++; } });
    return out.divideScalar(n);
  }
  const subjectD = (spec, ctx) => spec.rider != null ? ctx.d[spec.rider] : spec.d;

  // How far the camera at `pos` must rise for its line of sight to `target` to clear the terrain by `clear` m.
  function liftNeeded(pos, target, clear = 10) {
    let need = 0;
    const ty = target.y + 4;
    for (let s = 1; s <= 16; s++) {
      const k = s / 17;
      sight.lerpVectors(target, pos, k);
      const ground = elevation(sight.x, sight.z) + clear, lineY = ty + (pos.y - ty) * k;
      if (ground > lineY) need = Math.max(need, ty + (ground - ty) / k - pos.y);
    }
    return need;
  }
  function clearSight(pos, target, clear = 10) { pos.y += liftNeeded(pos, target, clear); return pos; }
  const lifted = (s, pos, target) => s._noLift ? pos : clearSight(pos, target); // resolve() measures the raw pose
  const floor = (pos, clear = 6) => { pos.y = Math.max(pos.y, elevation(pos.x, pos.z) + clear); return pos; };

  // Spherical placement around a subject, relative to the road heading h: theta 0 = behind, π = in front, +π/2 = right.
  function around(sub, h, theta, phi, radius, out = v()) {
    const a = h + Math.PI - theta;
    return out.set(sub.x + radius * Math.sin(phi) * Math.sin(a), sub.y + radius * Math.cos(phi), sub.z + radius * Math.sin(phi) * Math.cos(a));
  }

  const SHOTS = {
    // Behind the rider, slightly high, looking up the road.
    chase(s, ctx) {
      const sub = subject(s, ctx), h = heading(subjectD(s, ctx), s.span ?? 70);
      const pos = around(sub, h, s.theta ?? 0, s.phi ?? 1.32, (s.dist ?? 70) * Math.exp((s.push ?? 0) * ctx.sec));
      const look = tmp.set(sub.x + Math.sin(h) * (s.ahead ?? 25), sub.y + (s.lift ?? 6), sub.z + Math.cos(h) * (s.ahead ?? 25)).clone();
      return { pos: lifted(s, floor(pos), sub), look, fov: s.fov ?? 40 };
    },
    // Alongside on a long lens, like the moto camera.
    side(s, ctx) {
      const sub = subject(s, ctx), h = heading(subjectD(s, ctx), s.span ?? 90);
      const pos = around(sub, h, (s.sign ?? 1) * (Math.PI / 2 + (s.theta ?? 0) + (s.drift ?? 0) * ctx.sec), s.phi ?? 1.36, (s.dist ?? 150) * Math.exp((s.push ?? 0) * ctx.sec));
      const look = sub.clone().addScaledVector(new THREE.Vector3(Math.sin(h), 0, Math.cos(h)), s.ahead ?? 6).add(new THREE.Vector3(0, s.lift ?? 5, 0));
      return { pos: lifted(s, floor(pos), sub), look, fov: s.fov ?? 26 };
    },
    // From up the road, a long lens looking back down at the riders coming.
    ahead(s, ctx) {
      const sub = subject(s, ctx), h = heading(subjectD(s, ctx), s.span ?? 120);
      const pos = around(sub, h, Math.PI + (s.theta ?? 0), s.phi ?? 1.38, (s.dist ?? 500) * Math.exp((s.push ?? 0) * ctx.sec));
      return { pos: lifted(s, floor(pos), sub), look: sub.clone().add(new THREE.Vector3(0, s.lift ?? 6, 0)), fov: s.fov ?? 16 };
    },
    // A slow orbit round the rider or the group.
    orbit(s, ctx) {
      const sub = subject(s, ctx), h = s.fixed ? 0 : heading(subjectD(s, ctx), 120);
      const pos = around(sub, h, (s.theta ?? 0.8) + (s.spin ?? 0.06) * ctx.sec, s.phi ?? 1.0, (s.radius ?? 500) * Math.exp((s.push ?? 0) * ctx.sec));
      return { pos: lifted(s, floor(pos, 20), sub), look: sub.clone().add(new THREE.Vector3(0, s.lift ?? 0, 0)), fov: s.fov ?? 38 };
    },
    // Fixed at the roadside at road point d, like a phone held up as the riders come: optionally panning with a rider.
    roadside(s, ctx) {
      const base = at(s.d), h = heading(s.d, 25);
      const right = tmp.set(Math.cos(h), 0, -Math.sin(h)); // perpendicular to the road heading, on the right of the riders
      const pos = base.clone().addScaledVector(right, s.lateral ?? 14).add(new THREE.Vector3(0, s.height ?? 9, 0));
      pos.y = Math.max(pos.y, elevation(pos.x, pos.z) + (s.height ?? 9));
      // Down the road, where the riders come from (a spectator's view), or up it, after them (a rider's view).
      const along = at(s.d + (s.look === 'up' ? 1 : -1) * (s.back ?? 70)).add(new THREE.Vector3(0, s.lift ?? 5, 0));
      let look = along;
      if (s.follow != null) look = at(ctx.d[s.follow]).add(new THREE.Vector3(0, s.lift ?? 5, 0));
      if (s.blend != null && s.follow != null) look.lerp(along, s.blend);
      return { pos, look, fov: s.fov ?? 48 };
    },
    // High above the race, drifting.
    heli(s, ctx) {
      const sub = subject(s, ctx), h = heading(subjectD(s, ctx), 200);
      const pos = around(sub, h, (s.theta ?? 0.5) + (s.spin ?? 0.015) * ctx.sec, s.phi ?? 0.75, (s.radius ?? 1000) * Math.exp((s.push ?? 0) * ctx.sec));
      return { pos: floor(pos, 60), look: sub.clone().add(new THREE.Vector3(0, s.lift ?? 0, 0)), fov: s.fov ?? 34 };
    },
    // The whole mountain from far away.
    overview(s, ctx) {
      const c = at(s.d ?? len * 0.5);
      const pos = around(c, 0, (s.theta ?? 0.9) + (s.spin ?? 0.02) * ctx.sec, s.phi ?? 1.0, (s.radius ?? 6400) * Math.exp((s.push ?? 0) * ctx.sec));
      return { pos, look: c.clone().add(new THREE.Vector3(0, s.lift ?? 0, 0)), fov: s.fov ?? 40 };
    },
    // A spline over the terrain: keyframes relative to road points ({ d, off: [east, up, south] }, look { d, lift }).
    flyover(s, ctx) {
      const key = s._curve ??= {
        pos: new THREE.CatmullRomCurve3(s.path.map(p => at(p.d).add(new THREE.Vector3(...p.off))), false, 'centripetal'),
        look: new THREE.CatmullRomCurve3(s.path.map(p => at(p.look?.d ?? p.d).add(new THREE.Vector3(0, p.look?.lift ?? 0, 0))), false, 'centripetal'),
      };
      const u = (ease[s.ease ?? 'inOut'])(ctx.u);
      const pos = floor(key.pos.getPoint(u, v()), 30);
      return { pos, look: key.look.getPoint(u, v()), fov: s.fov ?? 42 };
    },
  };

  // Settle a shot's free choices once, from the race at a few of its frames: the side of the road
  // ('side' with sign 'auto': the valley side, where the slope does not hide the riders) and a swing
  // round the subject ('chase'/'ahead' with swing 'auto'), each the one that needs the least lift.
  function resolve(spec, ctxs) {
    if (spec.type === 'flyto') return { ...spec, to: resolve(spec.to, ctxs) };
    const lift = s => ctxs.reduce((sum, ctx) => {
      const raw = SHOTS[s.type]({ ...s, _noLift: true }, ctx);
      return sum + liftNeeded(raw.pos, subject(s, ctx));
    }, 0) / ctxs.length;
    let out = { ...spec };
    if (spec.type === 'side' && (spec.sign == null || spec.sign === 'auto')) {
      const a = lift({ ...out, sign: 1 }), b = lift({ ...out, sign: -1 });
      out.sign = a <= b ? 1 : -1;
    }
    if ((spec.type === 'chase' || spec.type === 'ahead' || spec.type === 'side') && spec.swing === 'auto') {
      let best = null;
      for (const off of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9]) {
        const cost = lift({ ...out, theta: (spec.theta ?? 0) + off }) + 120 * Math.abs(off);
        if (!best || cost < best.cost) best = { cost, off };
      }
      out.theta = (spec.theta ?? 0) + best.off;
    }
    return out;
  }

  // Pose of a shot spec at a frame context; `flyto` eases from a fixed start pose to a live target pose, craning up mid-move.
  function pose(spec, ctx) {
    if (spec.type === 'flyto') {
      const to = pose(spec.to, ctx), from = spec.from;
      const u = ease[spec.ease ?? 'inOut'](ctx.u);
      const pos = new THREE.Vector3().lerpVectors(from.pos, to.pos, u);
      pos.y += Math.sin(Math.PI * u) * (spec.arc ?? Math.min(400, from.pos.distanceTo(to.pos) * 0.25));
      const look = new THREE.Vector3().lerpVectors(from.look, to.look, Math.min(1, ease.inOut(Math.min(1, ctx.u * 1.15))));
      return { pos: floor(pos, 10), look, fov: from.fov + (to.fov - from.fov) * u };
    }
    const fn = SHOTS[spec.type];
    if (!fn) throw new Error(`unknown camera ${spec.type}`);
    const p = fn(spec, ctx);
    if (spec.shake) { // a little handheld life for the low shots: smooth pseudo-noise, deterministic
      const t = ctx.sec, k = spec.shake;
      p.look.add(new THREE.Vector3(Math.sin(t * 1.7) + Math.sin(t * 3.1) * 0.5, Math.sin(t * 2.3) * 0.6, Math.cos(t * 1.9)).multiplyScalar(k));
    }
    return p;
  }
  return { pose, resolve, at, heading };
}

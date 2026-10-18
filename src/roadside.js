// The road as it is on Coll de sa Batalla (see the riders' own clips): pale grey asphalt with
// white edge lines and a dashed centre line, low dry-stone walls along the drops, guardrails
// on the tight bends and the big drops, and the yellow kilometre posts. The grade-coloured
// route line and its halo stay for the wide shots, where they show the climb, and fade out close up.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

export function buildRoad({ scene, roadPoint, roadDir, elevation, len, STEP, ROAD_LIFT, ROAD_RADIUS, gradeRGB, roadPts }) {
  const roadN = Math.ceil(len / STEP) + 1;
  const p = new THREE.Vector3(), dir = new THREE.Vector3(), side = new THREE.Vector3();
  const frame = d => { roadPoint(d, p, ROAD_LIFT); side.crossVectors(roadDir(d, dir, 10), UP).normalize(); };

  // A strip along [d0, d1]: `across` rows of [offset in metres from the centre, height], one colour per row and point.
  function strip(across, color, d0 = 0, d1 = len, step = STEP, uv = null) {
    const n = Math.max(2, Math.ceil((d1 - d0) / step) + 1), K = across.length;
    const pos = new Float32Array(n * K * 3), col = new Float32Array(n * K * 3), uvs = uv && new Float32Array(n * K * 2), idx = [];
    for (let k = 0; k < n; k++) {
      const d = Math.min(d1, d0 + k * step);
      frame(d);
      across.forEach(([o, dy], j) => {
        pos.set([p.x + side.x * o, p.y + dy, p.z + side.z * o], (k * K + j) * 3);
        col.set(color(d, j), (k * K + j) * 3);
        if (uv) uvs.set(uv(d, j), (k * K + j) * 2);
      });
      if (k) for (let j = 0; j < K - 1; j++) { const a = (k - 1) * K + j, b = k * K + j; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  const merge = geoms => {
    const out = new THREE.BufferGeometry(), attrs = ['position', 'color', 'uv'].filter(a => geoms[0].attributes[a]);
    for (const a of attrs) out.setAttribute(a, new THREE.BufferAttribute(new Float32Array(geoms.reduce((n, g) => n + g.attributes[a].array.length, 0)), geoms[0].attributes[a].itemSize));
    const idx = [];
    let base = 0;
    const off = Object.fromEntries(attrs.map(a => [a, 0]));
    for (const g of geoms) {
      for (const a of attrs) { out.attributes[a].array.set(g.attributes[a].array, off[a]); off[a] += g.attributes[a].array.length; }
      for (const i of g.index.array) idx.push(i + base);
      base += g.attributes.position.count;
    }
    out.setIndex(idx);
    out.computeVertexNormals();
    return out;
  };

  // ---- asphalt and paint --------------------------------------------------------------------------
  // Old, sun-bleached asphalt; a little patchy along the road. Skirts hide gaps on cross-slopes.
  const R = ROAD_RADIUS;
  const tone = d => { const h = Math.sin(d * 0.013) * 0.5 + Math.sin(d * 0.071 + 1.3) * 0.3; return 0.16 + 0.025 * h; };
  scene.add(new THREE.Mesh(strip([[-R, -4], [-R, 0], [R, 0], [R, -4]], d => { const t = tone(d); return [t, t, t * 1.03]; }),
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  const paint = new THREE.MeshLambertMaterial({ color: 0xe9e7e0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const WHITE = () => [1, 1, 1];
  const edges = [-1, 1].map(s => strip([[s * (R - 0.32), 0.02], [s * (R - 0.18), 0.02]], WHITE));
  // Centre line: 3.5 m dashes, 9 m gaps (solid on the hairpins would need the road's markings; we draw dashes throughout).
  const dashes = [];
  for (let d = 6; d < len - 4; d += 12.5) dashes.push(strip([[-0.07, 0.02], [0.07, 0.02]], WHITE, d, d + 3.5, 1.75));
  scene.add(new THREE.Mesh(merge([...edges, ...dashes]), paint));

  // ---- the route drawn for the wide shots ------------------------------------------------------------
  const wide = [];
  const line = new THREE.Mesh(strip([[-0.6, 0.06], [0.6, 0.06]], d => gradeRGB(d).map(v => v * 1.5)),
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  const haloGeom = strip([[-2.8 * R, 0.1], [-R, 0.1], [R, 0.1], [2.8 * R, 0.1]], (d, j) => j === 1 || j === 2 ? [0.09, 0.065, 0.038] : [0, 0, 0]);
  const halo = new THREE.Mesh(haloGeom, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }));
  halo.renderOrder = 1;
  const thinGeom = new THREE.BufferGeometry().setFromPoints(roadPts.map(q => q.clone().setY(q.y + 0.6)));
  thinGeom.setAttribute('color', new THREE.Float32BufferAttribute(roadPts.flatMap((_, i) => gradeRGB(i / (roadPts.length - 1) * len).map(v => v * 1.6)), 3));
  const thin = new THREE.Line(thinGeom, new THREE.LineBasicMaterial({ vertexColors: true, fog: false, transparent: true }));
  scene.add(line, halo, thin);
  wide.push(line, halo, thin);

  // ---- walls and guardrails ----------------------------------------------------------------------------
  // Where the ground falls away beside the road there is a barrier: a dry-stone wall on the straights,
  // a steel guardrail on the tight bends and the big drops (both as on the climb).
  const kinds = [-1, 1].map(s => {
    const out = new Int8Array(roadN); // 0 none, 1 wall, 2 guardrail
    for (let k = 0; k < roadN; k++) {
      const d = Math.min(len, k * STEP);
      frame(d);
      const y = p.y - ROAD_LIFT, q = p.clone().addScaledVector(side, s * (R + 4));
      const drop = y - elevation(q.x, q.z);
      const a = roadDir(Math.max(0, d - 20), new THREE.Vector3(), 8), b = roadDir(Math.min(len, d + 20), new THREE.Vector3(), 8);
      const bend = Math.acos(Math.min(1, a.dot(b))) / 40; // rad per metre
      // the outside of a bend is the side the road turns away from
      const outside = Math.sign(a.clone().cross(b).y) === s;
      out[k] = drop < 2.2 ? 0 : (bend > 1 / 45 && outside) || drop > 9 ? 2 : 1;
    }
    // runs shorter than 16 m are noise; gaps shorter than 12 m are closed
    for (let k = 1; k < roadN - 3; k++) if (!out[k] && out[k - 1] && out[k - 1] === out[k + 2]) out[k] = out[k + 1] = out[k - 1];
    for (let k = 0; k < roadN;) {
      let e = k;
      while (e < roadN && out[e] === out[k]) e++;
      if (out[k] && e - k < 4) out.fill(0, k, e);
      k = e;
    }
    return out;
  });
  const runs = [];
  kinds.forEach((out, si) => {
    for (let k = 0; k < roadN;) {
      let e = k;
      while (e < roadN && out[e] === out[k]) e++;
      if (out[k]) runs.push({ s: si ? 1 : -1, kind: out[k], d0: k * STEP, d1: Math.min(len, (e - 1) * STEP) });
      k = e;
    }
  });

  const stoneTex = drystoneTexture();
  const walls = [], rails = [], postsAt = [];
  for (const { s, kind, d0, d1 } of runs) {
    if (kind === 1) {
      // inner face, cap, outer face down the slope; stone colour varies along the wall
      const o0 = s * (R + 0.25), o1 = s * (R + 0.75);
      const stone = d => { const v = 0.4 + 0.05 * Math.sin(d * 0.37) + 0.035 * Math.sin(d * 1.9); return [v, v * 0.96, v * 0.88]; };
      walls.push(strip([[o0, -0.3], [o0, 0.7], [o1, 0.78], [o1, -3.5]], stone, d0, d1, STEP, (d, j) => [d / 1.6, [0, 0.62, 0.7, 2.6][j]]));
    } else {
      const o = s * (R + 0.35);
      rails.push(strip([[o, 0.45], [o, 0.62], [o + s * 0.08, 0.7], [o, 0.78]], (d, j) => j === 2 ? [0.78, 0.8, 0.82] : [0.5, 0.52, 0.55], d0, d1, 2));
      for (let d = d0; d <= d1; d += 4) postsAt.push([d, o]);
    }
  }
  if (walls.length) scene.add(new THREE.Mesh(merge(walls), new THREE.MeshLambertMaterial({ map: stoneTex, vertexColors: true, side: THREE.DoubleSide })));
  if (rails.length) scene.add(new THREE.Mesh(merge(rails), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  if (postsAt.length) {
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.1, 0.12).translate(0, 0.25, 0), new THREE.MeshLambertMaterial({ color: 0x5b5146 }), postsAt.length);
    const m = new THREE.Matrix4();
    postsAt.forEach(([d, o], i) => { frame(d); posts.setMatrixAt(i, m.makeTranslation(p.x + side.x * o, p.y, p.z + side.z * o)); });
    posts.computeBoundingSphere();
    scene.add(posts);
  }

  // ---- kilometre posts ------------------------------------------------------------------------------------
  // Spanish road style: a short white post with a yellow plate on top carrying the kilometre.
  for (let km = 1; km * 1000 < len - 300; km++) {
    const d = len - km * 1000;
    frame(d);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.75, 0.16), new THREE.MeshLambertMaterial({ color: 0xf1efe8 }));
    body.position.y = 0.375;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.17), [0, 1, 2, 3].map(() => new THREE.MeshLambertMaterial({ color: 0xf5c400 })).concat([0, 1].map(() => new THREE.MeshLambertMaterial({ map: kmPlate(km) }))));
    plate.position.y = 0.93;
    g.add(body, plate);
    g.position.copy(p).addScaledVector(side, R + 0.9).setY(p.y - 0.1);
    g.lookAt(g.position.clone().sub(side)); // the plate faces the road
    g.scale.setScalar(1.6); // a touch larger than life, like the walls are not: it has to read from the moto
    scene.add(g);
  }

  return {
    // The wide-shot route fades in between 450 m and 1300 m from the camera's subject.
    update(dist) {
      const k = Math.min(1, Math.max(0, (dist - 450) / 850));
      for (const m of wide) { m.material.opacity = k; m.visible = k > 0.01; }
    },
  };
}

// Dry-stone wall: pale limestone blocks with dark joints, drawn once.
function drystoneTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4a4740'; ctx.fillRect(0, 0, 256, 128);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < 128;) {
    const h = 14 + rnd() * 14;
    for (let x = -rnd() * 30; x < 256;) {
      const w = 20 + rnd() * 34, v = 170 + rnd() * 60;
      ctx.fillStyle = `rgb(${v},${v * 0.96},${v * 0.88})`;
      ctx.beginPath(); ctx.roundRect(x + 1.5, y + 1.5, w - 3, h - 3, 4); ctx.fill();
      x += w;
    }
    y += h;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

function kmPlate(km) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f5c400'; ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#111'; ctx.font = '700 44px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(km), 32, 36);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

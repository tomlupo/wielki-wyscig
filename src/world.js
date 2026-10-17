// The 3D stage: terrain, sky, road, riders and the camera rig.
// Loaded as its own chunk so the HUD paints before three.js arrives.
import * as THREE from 'three';
import { gradeAt, gradeColor } from './profile.js';

const UP = new THREE.Vector3(0, 1, 0);
const RIDER_SCALE = 5; // riders are drawn 5× life size so they read on a 31 m terrain grid
const ROAD_LIFT = 1.6, ROAD_RADIUS = 2.6;
const FOLLOW_HOME = { theta: 0, phi: 1.2, radius: 150 };
const SIDE_HOME = { theta: Math.PI / 2, phi: 1.36, radius: 230 }; // level with the rider, square to the road
const SUN_DIR = new THREE.Vector3(-0.74, 0.56, 0.42).normalize(); // low WSW afternoon sun
const HAZE = new THREE.Color(0xc4d0da), ZENITH = new THREE.Color(0x2f5f9e), SUN_TINT = new THREE.Color(0xffd9a0);

// Async so the build yields to the browser between heavy steps (keeps phones responsive).
export async function createWorld({ container, labels, terrain, race, onSelect }) {
  const breathe = () => new Promise(resolve => setTimeout(resolve, 0));
  const coarse = matchMedia('(pointer: coarse)').matches;
  const still = matchMedia('(prefers-reduced-motion: reduce)'); // cut between camera poses instead of gliding, no idle spin
  const maxDpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
  let dpr = maxDpr;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '3D replay of the climb over aerial imagery and measured terrain');
  container.prepend(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(HAZE, 0.000052);
  const camera = new THREE.PerspectiveCamera(50, 1, 2, 60000);

  // ---- terrain ---------------------------------------------------------
  const { nx, ny, width, depth } = terrain;
  const bytes = Uint8Array.from(atob(terrain.heights), c => c.charCodeAt(0));
  const heights = new Uint16Array(bytes.buffer);
  // Exact height of the rendered mesh (same triangle split as PlaneGeometry), so the road sits on it.
  function elevation(x, z) {
    const u = Math.max(0, Math.min(nx - 1.0001, (x / width + 0.5) * (nx - 1)));
    const v = Math.max(0, Math.min(ny - 1.0001, (z / depth + 0.5) * (ny - 1)));
    const a = Math.floor(u), b = Math.floor(v), fx = u - a, fy = v - b;
    const h = (i, j) => heights[j * nx + i] / 10;
    if (fx + fy <= 1) return h(a, b) + (h(a + 1, b) - h(a, b)) * fx + (h(a, b + 1) - h(a, b)) * fy;
    return h(a + 1, b + 1) + (h(a, b + 1) - h(a + 1, b + 1)) * (1 - fx) + (h(a + 1, b) - h(a + 1, b + 1)) * (1 - fy);
  }
  const geom = new THREE.PlaneGeometry(width, depth, nx - 1, ny - 1);
  geom.rotateX(-Math.PI / 2);
  for (let i = 0; i < heights.length; i++) geom.attributes.position.setY(i, heights[i] / 10);
  geom.computeVertexNormals();
  // Terrain and sun never move, so cast shadows are baked once into vertex colours
  // (a ray march over the height grid) instead of paying for a shadow map every frame.
  {
    const shade = new Float32Array(heights.length * 3), hf = Float32Array.from(heights, v => v / 10);
    const cellX = width / (nx - 1), cellZ = depth / (ny - 1), hl = Math.hypot(SUN_DIR.x, SUN_DIR.z);
    const STEP = 2; // grid cells per march step
    const du = SUN_DIR.x / hl * STEP, dv = SUN_DIR.z / hl * STEP * cellX / cellZ, stepM = STEP * cellX, risePerStep = SUN_DIR.y / hl * stepM;
    let top = 0;
    for (const v of hf) top = Math.max(top, v);
    for (let j = 0; j < ny; j++) {
      if (j % 48 === 47) await breathe();
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i, h0 = hf[k] + 2;
        let margin = 1, u = i, v = j, ray = h0;
        for (let s = 1; s < 90; s++) {
          u += du; v += dv; ray += risePerStep;
          if (u < 0 || v < 0 || u >= nx - 1 || v >= ny - 1 || ray > top) break;
          const a = u | 0, b = v | 0, fx = u - a, fy = v - b, o = b * nx + a;
          const h = (hf[o] * (1 - fx) + hf[o + 1] * fx) * (1 - fy) + (hf[o + nx] * (1 - fx) + hf[o + nx + 1] * fx) * fy;
          margin = Math.min(margin, (ray - h) / (stepM * s));
          if (margin < -0.05) break;
        }
        const lit = 0.42 + 0.58 * Math.min(1, Math.max(0, (margin + 0.03) / 0.09));
        shade[k * 3] = lit; shade[k * 3 + 1] = lit; shade[k * 3 + 2] = Math.min(1, lit * 1.08);
      }
    }
    geom.setAttribute('color', new THREE.BufferAttribute(shade, 3));
  }
  await breathe();
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x8d8a74, vertexColors: true });
  // Fade the finite survey area into the haze so it never reads as a floating slab,
  // and add fine procedural grain up close, where the 4.7 m/px imagery turns soft.
  groundMat.onBeforeCompile = shader => {
    shader.uniforms.uSize = { value: new THREE.Vector2(width, depth) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vEdgeUv;\nvarying vec2 vWorldXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdgeUv = uv;\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vEdgeUv; varying vec2 vWorldXZ; uniform vec2 uSize;
        float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float grain = vnoise(vWorldXZ * 0.31) * 0.5 + vnoise(vWorldXZ * 1.1) * 0.3 + vnoise(vWorldXZ * 0.08) * 0.2;
        float near = 1.0 - smoothstep(120.0, 1100.0, length(vViewPosition));
        diffuseColor.rgb *= mix(1.0, 0.8 + 0.4 * grain, near);`)
      .replace('#include <fog_fragment>', `
        vec2 edgeM = min(vEdgeUv, 1.0 - vEdgeUv) * uSize;
        float edge = smoothstep(0.0, 1100.0, min(edgeM.x, edgeM.y));
        gl_FragColor.rgb = mix(fogColor, gl_FragColor.rgb, edge); // fogColor is already in output space
        #include <fog_fragment>`);
  };
  const ground = new THREE.Mesh(geom, groundMat);
  scene.add(ground);
  const textureReady = new Promise(resolve => new THREE.TextureLoader().load(terrain.texture, texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    groundMat.map = texture; groundMat.color.set(0xffffff); groundMat.needsUpdate = true;
    resolve();
  }, undefined, () => resolve()));

  // ---- sky and light ---------------------------------------------------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(40000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uHaze: { value: HAZE }, uZenith: { value: ZENITH }, uSun: { value: SUN_DIR }, uSunTint: { value: SUN_TINT } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: `varying vec3 vDir; uniform vec3 uHaze, uZenith, uSun, uSunTint;
      void main(){
        float h = max(vDir.y, 0.0);
        vec3 c = mix(uHaze, uZenith, pow(h, 0.55));
        float s = max(dot(normalize(vDir), uSun), 0.0);
        c += uSunTint * (pow(s, 8.0) * 0.35 + pow(s, 900.0) * 3.0);
        gl_FragColor = vec4(min(c, vec3(1.0)), 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  sky.material.toneMapped = false; // three applies fog after tone mapping; an untoned sky matches the fogged horizon
  sky.frustumCulled = false;
  scene.add(sky);
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x5a4a35, 1.15));
  const sun = new THREE.DirectionalLight(0xffe2b8, 2.6);
  sun.position.copy(SUN_DIR).multiplyScalar(9000);
  scene.add(sun, sun.target);

  // ---- road --------------------------------------------------------------
  const route = terrain.route, len = route.at(-1)[3], STEP = 4;
  const roadN = Math.ceil(len / STEP) + 1, roadXYZ = new Float32Array(roadN * 3);
  {
    let j = 0;
    for (let k = 0; k < roadN; k++) {
      const d = Math.min(len, k * STEP);
      while (j < route.length - 2 && route[j + 1][3] < d) j++;
      const a = route[j], b = route[j + 1], f = (d - a[3]) / (b[3] - a[3] || 1);
      const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f;
      roadXYZ.set([x, elevation(x, z), z], k * 3);
    }
  }
  function roadPoint(d, target = new THREE.Vector3(), lift = 0) {
    const u = Math.max(0, Math.min(roadN - 1.0001, d / STEP)), k = Math.floor(u), f = u - k, i = k * 3;
    return target.set(
      roadXYZ[i] + (roadXYZ[i + 3] - roadXYZ[i]) * f,
      roadXYZ[i + 1] + (roadXYZ[i + 4] - roadXYZ[i + 1]) * f + lift,
      roadXYZ[i + 2] + (roadXYZ[i + 5] - roadXYZ[i + 2]) * f);
  }
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  function roadDir(d, target = new THREE.Vector3(), span = 18) {
    roadPoint(Math.min(len, d + span), tmpA); roadPoint(Math.max(0, d - span), tmpB);
    return target.subVectors(tmpA, tmpB).normalize();
  }
  const roadPts = [];
  for (let d = 0; d < len; d += 8) roadPts.push(roadPoint(d, new THREE.Vector3(), ROAD_LIFT));
  roadPts.push(roadPoint(len, new THREE.Vector3(), ROAD_LIFT));
  const gradeRGB = d => gradeColor(gradeAt(route, d)).map(v => (v / 255) ** 2.2);
  {
    // Flat asphalt ribbon with skirts (hide gaps on cross-slopes) and a centre stripe coloured by grade.
    const ASPHALT = [0.045, 0.047, 0.05], across = [[-1, -4], [-1, 0], [-0.24, 0], [-0.2, 0], [0.2, 0], [0.24, 0], [1, 0], [1, -4]];
    const stripe = [false, false, false, true, true, false, false, false], K = across.length;
    const pos = new Float32Array(roadN * K * 3), col = new Float32Array(roadN * K * 3), idx = [];
    const p = new THREE.Vector3(), dir = new THREE.Vector3(), side = new THREE.Vector3();
    for (let k = 0; k < roadN; k++) {
      const d = Math.min(len, k * STEP);
      roadPoint(d, p, ROAD_LIFT);
      side.crossVectors(roadDir(d, dir, 10), UP).normalize();
      const c = gradeRGB(d);
      across.forEach(([s, dy], j) => {
        pos.set([p.x + side.x * s * ROAD_RADIUS, p.y + dy, p.z + side.z * s * ROAD_RADIUS], (k * K + j) * 3);
        col.set(stripe[j] ? c : ASPHALT, (k * K + j) * 3);
      });
      if (k) for (let j = 0; j < K - 1; j++) { const a = (k - 1) * K + j, b = k * K + j; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    }
    const ribbon = new THREE.BufferGeometry();
    ribbon.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    ribbon.setAttribute('color', new THREE.BufferAttribute(col, 3));
    ribbon.setIndex(idx);
    ribbon.computeVertexNormals();
    const road = new THREE.Mesh(ribbon, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    scene.add(road);
    // A 1 px line keeps the road visible from the far overview.
    const lineGeom = new THREE.BufferGeometry().setFromPoints(roadPts.map(q => q.clone().setY(q.y + 0.6)));
    lineGeom.setAttribute('color', new THREE.Float32BufferAttribute(roadPts.flatMap((_, i) => gradeRGB(i / (roadPts.length - 1) * len)), 3));
    scene.add(new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ vertexColors: true, fog: false })));
  }
  scene.add(arch(0, 'START · CAIMARI', '#ffffff'), arch(len, 'FINISH · COLL DE SA BATALLA', '#ffd34d'));

  function arch(d, text, accent) {
    const g = new THREE.Group(), dir = roadDir(d, new THREE.Vector3(), 30), side = new THREE.Vector3().crossVectors(dir, UP).normalize();
    const base = roadPoint(d, new THREE.Vector3()), postMat = new THREE.MeshLambertMaterial({ color: 0x1b1f22 });
    for (const s of [-1, 1]) {
      const p = base.clone().addScaledVector(side, s * 13);
      p.y = elevation(p.x, p.z);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, base.y - p.y + 20, 8), postMat);
      post.position.set(p.x, (p.y + base.y + 20) / 2, p.z);
      g.add(post);
    }
    const c = document.createElement('canvas'); c.width = 1024; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#111518'; ctx.fillRect(0, 0, 1024, 128);
    ctx.fillStyle = accent; ctx.fillRect(0, 0, 1024, 10); ctx.fillRect(0, 118, 1024, 10);
    ctx.fillStyle = '#ffffff'; ctx.font = '700 62px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, 66);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(27, 3.4), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    banner.position.copy(base).setY(base.y + 18);
    banner.lookAt(banner.position.clone().sub(dir.clone().setY(0))); // face riders arriving from below
    g.add(banner);
    return g;
  }

  await breathe();
  // ---- riders --------------------------------------------------------------
  const shared = {
    tube: new THREE.CylinderGeometry(1, 1, 1, 6), limb: new THREE.CylinderGeometry(1, 1, 1, 7),
    wheel: new THREE.TorusGeometry(0.34, 0.028, 6, 28), hub: new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8),
    head: new THREE.SphereGeometry(0.13, 14, 10), torso: new THREE.CapsuleGeometry(0.15, 0.42, 4, 10),
    dark: new THREE.MeshLambertMaterial({ color: 0x15181b }),
    skin: new THREE.MeshLambertMaterial({ color: 0xc8916c }),
    shorts: new THREE.MeshLambertMaterial({ color: 0x15161a }),
  };
  const beamGeom = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true).translate(0, 0.5, 0);
  const beamShader = {
    vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying float vY; uniform vec3 uColor; uniform float uAlpha; void main(){ gl_FragColor = vec4(uColor, pow(1.0 - vY, 2.2) * uAlpha); }',
  };
  const TRAIL_N = 60, TRAIL_LEN = 420;
  const riders = race.riders.map((data, i) => {
    const color = new THREE.Color(data.color);
    const jersey = new THREE.MeshLambertMaterial({ color });
    const g = new THREE.Group(), body = new THREE.Group();
    g.add(body);
    const limb = (mat, r) => { const m = new THREE.Mesh(shared.limb, mat); m.userData.r = r; body.add(m); return m; };
    const bar = (a, b, r, mat) => { const m = new THREE.Mesh(shared.tube, mat); placeBetween(m, a, b, r); body.add(m); return m; };
    const v = (x, y, z) => new THREE.Vector3(x, y, z);
    const rearHub = v(0, 0.34, -0.5), frontHub = v(0, 0.34, 0.5), bb = v(0, 0.3, -0.04), seat = v(0, 0.9, -0.22), head = v(0, 0.86, 0.4), bars = v(0, 0.92, 0.48);
    for (const hub of [rearHub, frontHub]) {
      const w = new THREE.Mesh(shared.wheel, shared.dark); w.position.copy(hub); w.rotation.y = Math.PI / 2; body.add(w);
    }
    bar(rearHub, bb, 0.022, jersey); bar(bb, seat, 0.024, jersey); bar(seat, head, 0.022, jersey); bar(bb, head, 0.028, jersey);
    bar(rearHub, seat, 0.018, jersey); bar(head, frontHub, 0.02, shared.dark); bar(head, bars, 0.02, shared.dark);
    const hip = v(0, 0.98, -0.2), shoulder = v(0, 1.33, 0.26);
    const torso = new THREE.Mesh(shared.torso, jersey); placeBetween(torso, hip, shoulder, 1, true); body.add(torso);
    const helmet = new THREE.Mesh(shared.head, jersey); helmet.position.set(0, 1.47, 0.37); helmet.scale.set(1, 0.9, 1.25); body.add(helmet);
    for (const s of [-1, 1]) bar(v(s * 0.17, 1.3, 0.26), v(s * 0.2, 0.95, 0.48), 0.04, shared.skin);
    const legs = [-1, 1].map(s => ({ s, thigh: limb(shared.shorts, 0.065), shin: limb(shared.skin, 0.045) }));
    g.scale.setScalar(RIDER_SCALE);
    scene.add(g);

    const beam = new THREE.Mesh(beamGeom, new THREE.ShaderMaterial({
      ...beamShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uColor: { value: color.clone() }, uAlpha: { value: 0.9 } },
    }));
    beam.frustumCulled = false;
    scene.add(beam);

    const trailGeom = new THREE.BufferGeometry();
    trailGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3));
    const trailColors = new Float32Array(TRAIL_N * 2 * 4);
    for (let k = 0; k < TRAIL_N; k++) {
      const f = (1 - k / (TRAIL_N - 1)) ** 1.4;
      for (const e of [0, 1]) trailColors.set([color.r, color.g, color.b, f], (k * 2 + e) * 4);
    }
    trailGeom.setAttribute('color', new THREE.BufferAttribute(trailColors, 4));
    const idx = [];
    for (let k = 0; k < TRAIL_N - 1; k++) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    trailGeom.setIndex(idx);
    const trail = new THREE.Mesh(trailGeom, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    trail.renderOrder = 1;
    trail.frustumCulled = false;
    scene.add(trail);

    const label = document.createElement('button');
    label.className = 'rlabel';
    label.style.setProperty('--c', data.color);
    label.innerHTML = `<b>${data.letter}</b><span></span>`;
    label.querySelector('span').textContent = data.name;
    label.setAttribute('aria-label', `Follow ${data.name}`);
    label.addEventListener('click', e => { e.stopPropagation(); onSelect(i); });
    labels.append(label);

    return { g, body, legs, beam, trail, label, lane: (i - (race.riders.length - 1) / 2) * 0.22, phase: i * 1.7, pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1) };
  });

  function placeBetween(mesh, a, b, r, keepScale = false) {
    const mid = tmpA.addVectors(a, b).multiplyScalar(0.5), dir = tmpB.subVectors(b, a), l = dir.length();
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(UP, dir.divideScalar(l || 1));
    if (!keepScale) mesh.scale.set(r, l, r);
  }

  const crank = 0.17, thighL = 0.47, shinL = 0.46;
  const hipP = new THREE.Vector3(), footP = new THREE.Vector3(), kneeP = new THREE.Vector3(), perp = new THREE.Vector3();
  function pedal(r) {
    for (const leg of r.legs) {
      const a = r.phase + (leg.s > 0 ? Math.PI : 0);
      hipP.set(leg.s * 0.1, 0.98, -0.2);
      footP.set(leg.s * 0.12, 0.3 + Math.cos(a) * crank, -0.04 + Math.sin(a) * crank);
      const L = Math.min(hipP.distanceTo(footP), thighL + shinL - 0.001);
      // Two-bone IK in the sagittal plane: knee bends forward.
      const along = (thighL * thighL - shinL * shinL + L * L) / (2 * L), up = Math.sqrt(Math.max(0, thighL * thighL - along * along));
      tmpA.subVectors(footP, hipP).normalize();
      perp.set(0, -tmpA.z, tmpA.y);
      if (perp.z < 0) perp.negate();
      kneeP.copy(hipP).addScaledVector(tmpA, along).addScaledVector(perp, up);
      placeBetween(leg.thigh, hipP, kneeP.clone(), leg.thigh.userData.r);
      placeBetween(leg.shin, kneeP.clone(), footP, leg.shin.userData.r);
    }
  }

  // ---- labels for start / finish ----------------------------------------
  const marks = [[0, `Caimari · ${Math.round(route[0][2])} m`], [len, `Coll de sa Batalla · ${Math.round(route.at(-1)[2])} m`]].map(([d, text]) => {
    const el = document.createElement('div'); el.className = 'mark'; el.textContent = text; labels.append(el);
    return { el, p: roadPoint(d, new THREE.Vector3(), 40) };
  });

  await breathe();
  // ---- camera rig ----------------------------------------------------------
  let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity, ysum = 0;
  for (const p of roadPts) { xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x); zmin = Math.min(zmin, p.z); zmax = Math.max(zmax, p.z); ysum += p.y; }
  const centre = new THREE.Vector3((xmin + xmax) / 2, ysum / roadPts.length, (zmin + zmax) / 2);
  const rig = {
    mode: 'overview', selected: 0, lastInput: -1e9, transitionUntil: 0,
    orbit: { target: centre.clone(), radius: 6200, theta: 0.42, phi: 0.98 },
    follow: { ...FOLLOW_HOME }, // the chase pose around the selected rider, shared by follow and side
    intro: null,
  };
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
  let aspect = 1;

  function overviewPose() {
    const portrait = aspect < 1;
    Object.assign(rig.orbit, { radius: portrait ? 7600 : 5600, theta: portrait ? 0.32 : 0.95, phi: portrait ? 0.92 : 1.02 });
    rig.orbit.target.copy(centre);
  }
  overviewPose();

  function setMode(mode, { instant = false } = {}) {
    if (mode === 'overview') overviewPose();
    if (mode === 'free' && rig.mode !== 'overview') {
      rig.orbit.target.copy(riders[rig.selected].pos);
      Object.assign(rig.orbit, { radius: 900, phi: 0.9 });
    }
    if (mode === 'follow') Object.assign(rig.follow, { ...FOLLOW_HOME });
    if (mode === 'side') Object.assign(rig.follow, { ...SIDE_HOME, theta: SIDE_HOME.theta * openSide() });
    rig.mode = mode;
    rig.intro = null;
    rig.transitionUntil = instant ? 0 : performance.now() + 1600;
  }

  function orbitPosition(o, out) {
    return out.set(
      o.target.x + o.radius * Math.sin(o.phi) * Math.sin(o.theta),
      o.target.y + o.radius * Math.cos(o.phi),
      o.target.z + o.radius * Math.sin(o.phi) * Math.cos(o.theta));
  }

  // The chase heading follows the road over 140 m and turns slowly, so hairpins do not whip the camera.
  let chaseHeading = null;
  const chaseDir = new THREE.Vector3();
  // Side profile looks across the road from the open (lower) side, so the slope is not hidden by the hill.
  function openSide() {
    const r = riders[rig.selected], side = tmpA.crossVectors(r.dir, UP).normalize(), reach = SIDE_HOME.radius;
    const left = elevation(r.pos.x + side.x * reach, r.pos.z + side.z * reach), right = elevation(r.pos.x - side.x * reach, r.pos.z - side.z * reach);
    return left <= right ? -1 : 1;
  }
  let sideCheck = 0;
  function desiredPose(now, dt) {
    const r = riders[rig.selected];
    if (rig.mode === 'follow' || rig.mode === 'side') {
      const side = rig.mode === 'side';
      roadDir(currentD[rig.selected], chaseDir, side ? 120 : 70);
      const target = Math.atan2(chaseDir.x, chaseDir.z);
      if (chaseHeading === null) chaseHeading = target;
      const delta = Math.atan2(Math.sin(target - chaseHeading), Math.cos(target - chaseHeading));
      chaseHeading += delta * Math.min(1, dt * (side ? 0.8 : 1.6));
      // As the road turns, the side camera crosses over when the other side is clearly lower.
      if (side && now - sideCheck > 2000 && Math.abs(Math.abs(rig.follow.theta) - Math.PI / 2) < 0.6) {
        sideCheck = now;
        const want = openSide();
        if (Math.sign(rig.follow.theta) !== want) rig.follow.theta = -rig.follow.theta;
      }
      const f = rig.follow, heading = chaseHeading + Math.PI + f.theta;
      wantPos.set(
        r.pos.x + f.radius * Math.sin(f.phi) * Math.sin(heading),
        r.pos.y + f.radius * Math.cos(f.phi) + 6,
        r.pos.z + f.radius * Math.sin(f.phi) * Math.cos(heading));
      const ahead = side ? 0 : 45;
      wantLook.set(r.pos.x + Math.sin(chaseHeading) * ahead, r.pos.y + (side ? 8 : 16), r.pos.z + Math.cos(chaseHeading) * ahead);
    } else {
      if (rig.mode === 'overview' && !still.matches && now - rig.lastInput > 5000) rig.orbit.theta += 0.00004 * (now - lastNow);
      orbitPosition(rig.orbit, wantPos);
      wantLook.copy(rig.orbit.target);
    }
  }

  // ---- intro fly-over --------------------------------------------------------
  function startIntro({ duration = 11000, onProgress, onDone } = {}) {
    const P = f => roadPoint(len * f, new THREE.Vector3());
    const start = P(0), dir0 = roadDir(40, new THREE.Vector3(), 40);
    const add = (p, x, y, z) => p.clone().add(new THREE.Vector3(x, y, z));
    const positions = [
      add(centre, -2600, 3400, -7200),
      add(P(1), -1100, 820, -900),
      add(P(0.62), 900, 560, 250),
      add(P(0.3), -750, 520, 650),
      start.clone().addScaledVector(dir0, -110).add(new THREE.Vector3(0, 125, 0)),
    ];
    const looks = [centre.clone(), P(1), P(0.48), P(0.12), start.clone().addScaledVector(dir0, 20)];
    rig.intro = {
      t0: performance.now(), duration, onProgress, onDone,
      pos: new THREE.CatmullRomCurve3(positions, false, 'centripetal'),
      look: new THREE.CatmullRomCurve3(looks, false, 'centripetal'),
    };
    rig.mode = 'follow';
    Object.assign(rig.follow, { ...FOLLOW_HOME });
  }
  function skipIntro() {
    if (!rig.intro) return;
    const done = rig.intro.onDone;
    rig.intro = null;
    rig.transitionUntil = performance.now() + 1400;
    done?.();
  }

  // ---- input --------------------------------------------------------------
  // Mouse: drag orbits, right- or shift-drag pans, the wheel zooms.
  // Touch: one finger belongs to the page — the canvas and the rider labels are `touch-action: pan-y`, so a
  // vertical swipe scrolls and a sideways one only earns the two-finger hint. Two
  // fingers move the map: drag pans (or swings a rider camera), pinch zooms, twist turns.
  const pointers = new Map();
  let pinch = 0, mid = null, angle = null, lastTap = 0, dragged = 0;
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const touchCount = () => [...pointers.values()].filter(p => p.touch).length;
  const twoFinger = () => {
    const [a, b] = [...pointers.values()].filter(p => p.touch);
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], angle: Math.atan2(b.y - a.y, b.x - a.x) };
  };
  container.addEventListener('pointerdown', e => {
    if (rig.intro) { skipIntro(); return; }
    const touch = e.pointerType === 'touch';
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, touch });
    if (!touch && e.target === canvas) canvas.setPointerCapture(e.pointerId);
    dragged = 0;
    rig.lastInput = performance.now();
    if (touch && touchCount() === 2) ({ dist: pinch, mid, angle } = twoFinger());
  });
  container.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    dragged += Math.abs(dx) + Math.abs(dy);
    if (p.touch) {
      if (touchCount() < 2) { if (dragged > 14) onHint?.(); return; }
      rig.lastInput = performance.now();
      const now = twoFinger();
      if (pinch) zoom(pinch / now.dist);
      if (angle !== null) turn(Math.atan2(Math.sin(now.angle - angle), Math.cos(now.angle - angle)));
      if (mid) {
        const mx = now.mid[0] - mid[0], my = now.mid[1] - mid[1];
        if (rig.mode === 'follow' || rig.mode === 'side') rotate(mx, my); else pan(mx, my);
      }
      ({ dist: pinch, mid, angle } = now);
      return;
    }
    if (!e.buttons) { pointers.delete(e.pointerId); return; } // released outside the stage: no hover-orbit
    rig.lastInput = performance.now();
    if (e.shiftKey || e.buttons === 2) pan(dx, dy);
    else rotate(dx, dy);
  });
  const release = e => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    pinch = 0; mid = null; angle = null;
    // The browser took a one-finger swipe for page scroll: say once how the map moves.
    if (e.type === 'pointercancel' && p?.touch && !hintedOnScroll) { hintedOnScroll = true; onHint?.(); }
    if (e.type === 'pointerup' && dragged < 8 && e.target === canvas) {
      const now = performance.now();
      if (now - lastTap < 320) doubleTap(e);
      lastTap = now;
    }
  };
  let hintedOnScroll = false;
  container.addEventListener('pointerup', release);
  container.addEventListener('pointercancel', release);
  // Two fingers down: keep the page still so the gesture reaches the map.
  const holdPage = e => { if (e.touches.length > 1 && e.cancelable) e.preventDefault(); };
  container.addEventListener('touchstart', holdPage, { passive: false });
  container.addEventListener('touchmove', holdPage, { passive: false });
  container.addEventListener('contextmenu', e => e.preventDefault());
  container.addEventListener('wheel', e => { e.preventDefault(); if (rig.intro) return skipIntro(); rig.lastInput = performance.now(); zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });

  const chasing = () => rig.mode === 'follow' || rig.mode === 'side';
  function rotate(dx, dy) {
    if (chasing()) {
      rig.follow.theta -= dx * 0.006;
      rig.follow.phi = Math.max(0.35, Math.min(1.42, rig.follow.phi - dy * 0.005));
    } else {
      rig.orbit.theta -= dx * 0.005;
      rig.orbit.phi = Math.max(0.12, Math.min(1.42, rig.orbit.phi - dy * 0.005));
    }
  }
  function turn(radians) {
    if (chasing()) rig.follow.theta += radians;
    else rig.orbit.theta += radians;
  }
  function zoom(f) {
    if (chasing()) rig.follow.radius = Math.max(25, Math.min(1500, rig.follow.radius * f));
    else rig.orbit.radius = Math.max(120, Math.min(14000, rig.orbit.radius * f));
  }
  function pan(dx, dy) {
    if (rig.mode === 'overview') { rig.mode = 'free'; onModeChange?.('free'); }
    const k = rig.orbit.radius * 0.0016, s = Math.sin(rig.orbit.theta), c = Math.cos(rig.orbit.theta);
    rig.orbit.target.x -= (dx * c + dy * s) * k;
    rig.orbit.target.z -= (-dx * s + dy * c) * k;
    rig.orbit.target.y = elevation(rig.orbit.target.x, rig.orbit.target.z);
  }
  function doubleTap(e) {
    if (chasing()) { setMode(rig.mode); return; }
    const rect = canvas.getBoundingClientRect();
    ndc.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(ground)[0];
    if (!hit) return;
    rig.mode = 'free';
    rig.orbit.target.copy(hit.point);
    rig.orbit.radius = Math.min(rig.orbit.radius, 1100);
    rig.transitionUntil = performance.now() + 1200;
    onModeChange?.('free');
  }
  let onModeChange = null, onHint = null;

  // ---- frame ----------------------------------------------------------------
  const currentD = race.riders.map(() => 0);
  const project = new THREE.Vector3(), trailP = new THREE.Vector3(), trailS = new THREE.Vector3();
  let lastNow = performance.now(), slowFrames = 0, frames = 0, w = 1, h = 1, insetRight = 0, lastKey = '';

  // A right-hand panel (desktop) covers part of the canvas: shift the centre of
  // projection so the subject sits in the middle of the visible area.
  function resize() {
    w = container.clientWidth; h = container.clientHeight;
    aspect = (w - insetRight) / h;
    camera.fov = aspect < 0.8 ? 62 : 48;
    camera.aspect = (w + insetRight) / h;
    if (insetRight) camera.setViewOffset(w + insetRight, h, insetRight, 0, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    if (rig.mode === 'overview') overviewPose();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  function frame({ time, distances, playing, rate }) {
    const now = performance.now();
    const realDt = Math.min(0.1, (now - lastNow) / 1000);
    // Adaptive resolution: step pixel ratio down if the phone cannot hold ~45 fps.
    frames++;
    if (realDt > 0.024) slowFrames++;
    if (frames === 30) {
      if (slowFrames > 15 && dpr > 0.75) { dpr = Math.max(0.75, dpr - (slowFrames > 25 ? 0.5 : 0.25)); renderer.setPixelRatio(dpr); resize(); }
      frames = slowFrames = 0;
    }

    riders.forEach((r, i) => {
      const d = distances[i], moving = playing && d < len && d > 0;
      currentD[i] = d;
      roadDir(d, r.dir);
      const side = tmpA.crossVectors(r.dir, UP).normalize();
      roadPoint(d, r.pos, ROAD_LIFT).addScaledVector(side, r.lane * RIDER_SCALE);
      r.g.position.copy(r.pos);
      r.g.rotation.set(0, Math.atan2(r.dir.x, r.dir.z), 0);
      r.body.rotation.x = -Math.asin(Math.max(-0.3, Math.min(0.3, r.dir.y)));
      if (moving) r.phase += realDt * Math.min(1.45 * rate, 2.3) * Math.PI * 2;
      if (moving || r.posedAt !== d) { pedal(r); r.posedAt = d; }

      const camDist = camera.position.distanceTo(r.pos), sel = i === rig.selected;
      r.g.visible = camDist < 2500; // LOD: far away the beam and label carry the rider, the jointed model is skipped
      const bh = Math.max(18, camDist * (sel ? 0.12 : 0.085)), bw = Math.max(0.6, camDist * (sel ? 0.0026 : 0.0018));
      r.beam.position.copy(r.pos);
      r.beam.scale.set(bw, bh, bw);
      r.beam.material.uniforms.uAlpha.value = Math.min(0.95, camDist / 600) * (sel ? 1 : 0.7);

      const half = Math.max(0.9, Math.min(9, camDist * 0.002)), trailKey = `${d}:${half.toFixed(1)}`;
      r.trail.material.opacity = sel ? 1 : 0.4;
      if (r.trailKey === trailKey) return; // trail only rebuilds when the rider or the zoom moved
      r.trailKey = trailKey;
      const pos = r.trail.geometry.attributes.position;
      for (let k = 0; k < TRAIL_N; k++) {
        const dd = Math.max(0, d - k * TRAIL_LEN / (TRAIL_N - 1));
        roadPoint(dd, trailP, ROAD_LIFT + 0.3);
        roadDir(dd, trailS).cross(UP).normalize();
        pos.setXYZ(k * 2, trailP.x + trailS.x * half, trailP.y, trailP.z + trailS.z * half);
        pos.setXYZ(k * 2 + 1, trailP.x - trailS.x * half, trailP.y, trailP.z - trailS.z * half);
      }
      pos.needsUpdate = true;
    });

    if (rig.intro) {
      const u = Math.min(1, (now - rig.intro.t0) / rig.intro.duration), e = u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
      rig.intro.pos.getPoint(e, camPos);
      rig.intro.look.getPoint(e, camLook);
      rig.intro.onProgress?.(u);
      if (u >= 1) skipIntro();
    } else {
      desiredPose(now, realDt);
      const transition = now < rig.transitionUntil, dragging = pointers.size > 0;
      const lambda = transition ? 2.6 : dragging ? 14 : chasing() ? 5 : 6;
      const k = still.matches && !dragging ? 1 : 1 - Math.exp(-realDt * lambda);
      camPos.lerp(wantPos, k);
      camLook.lerp(wantLook, Math.min(1, k * 1.4));
    }
    camPos.y = Math.max(camPos.y, elevation(camPos.x, camPos.z) + 14);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    camera.updateMatrixWorld();
    sky.position.copy(camera.position);

    // HTML labels follow their 3D anchors.
    riders.forEach((r, i) => {
      project.copy(r.pos).y += 2.2 * RIDER_SCALE;
      project.project(camera);
      const visible = project.z < 1 && Math.abs(project.x) < 1.05 && Math.abs(project.y) < 1.05;
      r.label.hidden = !visible;
      if (visible) r.label.style.transform = `translate3d(${(project.x * 0.5 + 0.5) * w}px,${(-project.y * 0.5 + 0.5) * h}px,0)`;
      r.label.classList.toggle('sel', i === rig.selected);
      r.label.style.zIndex = i === rig.selected ? 3 : 2;
    });
    for (const m of marks) {
      project.copy(m.p).project(camera);
      const visible = project.z < 1 && Math.abs(project.x) < 0.95 && Math.abs(project.y) < 0.95 && camera.position.distanceTo(m.p) > 250;
      m.el.hidden = !visible;
      if (visible) m.el.style.transform = `translate3d(${(project.x * 0.5 + 0.5) * w}px,${(-project.y * 0.5 + 0.5) * h}px,0)`;
    }

    // Render on demand: a paused, settled view costs nothing.
    const key = `${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)},${camLook.x.toFixed(2)},${camLook.z.toFixed(2)},${time},${rig.selected},${w},${h},${dpr}`;
    if (key !== lastKey || playing || rig.intro) { renderer.render(scene, camera); lastKey = key; }
    lastNow = now;
  }

  // First frame: set the camera onto the overview so the first paint is not black.
  orbitPosition(rig.orbit, camPos); camLook.copy(rig.orbit.target);
  textureReady.then(() => { lastKey = ''; });

  return {
    frame, setMode, startIntro, skipIntro,
    // Ready once imagery is decoded and shaders are compiled (in parallel where the GPU allows).
    ready: textureReady.then(() => renderer.extensions.has('KHR_parallel_shader_compile') && renderer.compileAsync(scene, camera)).catch(() => {}),
    get introRunning() { return !!rig.intro; },
    select(i) { rig.selected = i; },
    onModeChange(fn) { onModeChange = fn; },
    onHint(fn) { onHint = fn; },
    get cameraPosition() { return camera.position.toArray(); },
    setInsetRight(px) { if (px !== insetRight) { insetRight = px; resize(); } },
  };
}

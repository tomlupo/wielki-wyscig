// The 3D stage: terrain, sky, road, riders and the camera rig.
// Loaded as its own chunk so the HUD paints before three.js arrives.
import * as THREE from 'three';
import { gradeAt, gradeColor } from './profile.js';
import { SUN_DIR, SUN_COLOR, createSky, createSea, createFarLand } from './atmosphere.js';
import { buildTerrain } from './terrain.js';
import { createCorridor } from './corridor.js';
import { buildTrees } from './trees.js';
import { buildRoad } from './roadside.js';
import { createPost } from './post.js';

const UP = new THREE.Vector3(0, 1, 0);
const RIDER_SCALE = 3; // riders are drawn 3× life size: they read from the moto, and do not tower over real-size trees
const ROAD_LIFT = 1.1, ROAD_RADIUS = 3.1; // a 6 m road, as on the climb; lifted a little over the 15 m mesh, skirts hide the rest
// Camera framings: offsets of the follow rig around the rider (theta: around, 0 = behind;
// phi: from vertical; fov: vertical degrees on a landscape screen, ×1.3 on a portrait one).
// Wide and long-lens on purpose: the riders sit IN the landscape, their labels carry them.
const FOLLOW_HOME = { theta: 0, phi: 1.33, radius: 320, ahead: 50, lift: 10, fov: 38 };
// Broadcast shots for the auto camera. spin: slow orbit (rad/s); push: slow dolly (radius ×e^(push·t));
// group: frame the riders around the selected one, not the rider alone.
const SHOTS = {
  side: { theta: Math.PI / 2, phi: 1.3, radius: 200, ahead: 6, lift: 6, fov: 30, push: -0.012 }, // moto alongside, long lens
  heli: { theta: 0.55, phi: 0.72, radius: 950, ahead: 40, lift: 0, fov: 36, spin: 0.012 }, // helicopter above the race
  drone: { theta: 0.9, phi: 0.98, radius: 560, ahead: 0, lift: 0, fov: 40, spin: 0.07, group: true }, // slow orbit round the group
  high: { theta: Math.PI / 2, phi: 0.74, radius: 780, ahead: 0, lift: 0, fov: 32, push: -0.02, group: true }, // high side tracking
  ahead: { theta: Math.PI, phi: 1.4, radius: 680, ahead: 0, lift: 8, fov: 18, push: -0.03 }, // long lens from up the road
};
const POV_FOV = 55, MAP_FOV = 42;

// Async so the build yields to the browser between heavy steps (keeps phones responsive).
export async function createWorld({ container, labels, terrain, race, onSelect, onPageDrag, keepOut = null }) {
  const breathe = () => new Promise(resolve => setTimeout(resolve, 0));
  const coarse = matchMedia('(pointer: coarse)').matches;
  const lite = coarse && (navigator.hardwareConcurrency || 8) <= 4; // a weak phone: lighter mesh, no bloom
  const maxDpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
  let dpr = maxDpr;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  const canvas = renderer.domElement;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '3D replay of the climb over aerial imagery and measured terrain');
  container.prepend(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff); // switches on the aerial-perspective haze (atmosphere.js)
  const camera = new THREE.PerspectiveCamera(FOLLOW_HOME.fov, 1, 2, 60000);

  // ---- terrain, sky and light ---------------------------------------------
  const { width, depth } = terrain;
  // 25 cm imagery along the road: phones take the 0.5 m tiles (a quarter of the memory).
  const corridor = createCorridor({ renderer, hi: !coarse });
  const { ground, elevation, textureReady } = await buildTerrain({ terrain, renderer, lite, phone: coarse, corridor });
  scene.add(ground);
  // The tile index and the trees arrive after the first picture: the race never waits for them.
  let trees = null, sceneDirty = false;
  fetch('/corridor/index.json').then(r => r.ok ? r.json() : Promise.reject(r.status)).then(async index => {
    corridor.setIndex(index, width, depth);
    const built = await buildTrees({ index, terrain, elevation, lite, phone: coarse });
    scene.add(built.group);
    trees = built;
    sceneDirty = true;
  }).catch(error => console.warn('corridor imagery unavailable', error));
  await breathe();
  const sky = createSky(), sea = createSea();
  scene.add(sky, sea, createFarLand({ width, depth, elevation }));
  scene.add(new THREE.HemisphereLight(0xd2dce6, 0x786650, 2.1)); // a bright, slightly overcast sky
  const sun = new THREE.DirectionalLight(SUN_COLOR, 4.4);
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
  const road = buildRoad({ scene, roadPoint, roadDir, elevation, len, STEP, ROAD_LIFT, ROAD_RADIUS, gradeRGB, roadPts });
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

  // ---- kilometre boards and the summit flag ------------------------------------
  const kmBoards = [];
  for (let km = 1; km * 1000 < len - 300; km++) { // climb style: kilometres to the summit
    const d = len - km * 1000, p = roadPoint(d, new THREE.Vector3()), side = new THREE.Vector3().crossVectors(roadDir(d), UP).normalize();
    const c = document.createElement('canvas'); c.width = 256; c.height = 96;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(10,13,12,0.82)'; ctx.beginPath(); ctx.roundRect(4, 4, 248, 88, 44); ctx.fill();
    ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(48, 48, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 52px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    ctx.fillText(`${km} KM`, 78, 51);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    board.scale.set(16, 6, 1);
    board.position.copy(p).addScaledVector(side, ROAD_RADIUS + 9).setY(p.y + 9);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 7, 6), new THREE.MeshLambertMaterial({ color: 0xe8e4da }));
    post.position.copy(board.position).setY(p.y + 3);
    scene.add(board, post);
    kmBoards.push(board);
  }
  const summitRow = route.reduce((best, q) => q[2] > best[2] ? q : best);
  const flag = (() => {
    const d = summitRow[3], p = roadPoint(d, new THREE.Vector3()), side = new THREE.Vector3().crossVectors(roadDir(d), UP).normalize();
    const foot = p.clone().addScaledVector(side, -(ROAD_RADIUS + 22));
    foot.y = elevation(foot.x, foot.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 30, 8), new THREE.MeshLambertMaterial({ color: 0xdcd8cf }));
    pole.position.copy(foot).setY(foot.y + 15);
    // King-of-the-mountain polka dots
    const c = document.createElement('canvas'); c.width = 256; c.height = 160;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 256, 160);
    ctx.fillStyle = '#e3262f';
    for (let y = 0; y < 5; y++) for (let x = 0; x < 8; x++) { ctx.beginPath(); ctx.arc(16 + x * 32 + (y % 2) * 16, 16 + y * 32, 9, 0, Math.PI * 2); ctx.fill(); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(14, 9, 14, 3).translate(7, 0, 0), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    cloth.position.copy(foot).setY(foot.y + 25);
    cloth.rotation.y = Math.atan2(SUN_DIR.x, SUN_DIR.z) + Math.PI / 2; // streams across the light
    const rest = Float32Array.from(cloth.geometry.attributes.position.array);
    scene.add(pole, cloth);
    return { cloth, rest };
  })();
  function waveFlag(t) {
    const a = flag.cloth.geometry.attributes.position;
    for (let k = 0; k < a.count; k++) {
      const x = flag.rest[k * 3], y = flag.rest[k * 3 + 1];
      a.setZ(k, Math.sin(x * 0.45 - t * 4.2 + y * 0.1) * x * 0.11);
    }
    a.needsUpdate = true;
    flag.cloth.geometry.computeVertexNormals();
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
    shadow: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    puck: new THREE.RingGeometry(0.42, 0.6, 40).rotateX(-Math.PI / 2),
  };
  // A soft contact shadow, stretched away from the sun.
  const shadowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d'), grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(0,0,0,0.75)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
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
    const shadow = new THREE.Mesh(shared.shadow, shadowMat);
    shadow.scale.set(1.0, 1, 2.4);
    shadow.renderOrder = 1;
    body.add(shadow);
    // A glowing puck in the rider's colour (it blooms), so a rider reads in a wide shot.
    const puck = new THREE.Mesh(shared.puck, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    puck.position.y = 0.03;
    puck.renderOrder = 2;
    body.add(puck);
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
      for (const e of [0, 1]) trailColors.set([color.r * 1.2, color.g * 1.2, color.b * 1.2, f], (k * 2 + e) * 4);
    }
    trailGeom.setAttribute('color', new THREE.BufferAttribute(trailColors, 4));
    const idx = [];
    for (let k = 0; k < TRAIL_N - 1; k++) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    trailGeom.setIndex(idx);
    const trail = new THREE.Mesh(trailGeom, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
    trail.renderOrder = 1;
    trail.frustumCulled = false;
    scene.add(trail);

    const label = document.createElement('button');
    label.className = 'rlabel';
    label.style.setProperty('--c', data.color);
    label.innerHTML = `<b${data.ring ? ' class="ring"' : ''}></b><span></span><em hidden></em>`;
    label.querySelector('span').textContent = data.name;
    const more = label.querySelector('em');
    label.setAttribute('aria-label', `Follow ${data.name}`);
    label.addEventListener('click', e => { e.stopPropagation(); onSelect(i); });
    labels.append(label);

    return { g, body, legs, beam, trail, label, more, shadow, puck, lane: (i - (race.riders.length - 1) / 2) * 0.22, phase: i * 1.7, pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1) };
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
  // Media moments: a small camera pin standing on the road where a clip was filmed.
  const pins = [];
  function addPin({ d, label, onClick, stack = 0 }) {
    const el = document.createElement('button');
    el.className = 'pin';
    el.style.setProperty('--stack', stack);
    el.setAttribute('aria-label', label);
    el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="12.5" height="10" rx="2"/><path d="m15.5 10.5 5-3v9l-5-3z"/></svg>';
    el.addEventListener('click', e => { e.stopPropagation(); onClick(); });
    labels.append(el);
    pins.push({ el, p: roadPoint(d, new THREE.Vector3(), 3) });
    lastKey = '';
  }

  await breathe();
  // ---- camera rig ----------------------------------------------------------
  let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity, ysum = 0;
  for (const p of roadPts) { xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x); zmin = Math.min(zmin, p.z); zmax = Math.max(zmax, p.z); ysum += p.y; }
  const centre = new THREE.Vector3((xmin + xmax) / 2, ysum / roadPts.length, (zmin + zmax) / 2);
  const rig = {
    mode: 'overview', selected: 0, lastInput: -1e9, transitionUntil: 0,
    orbit: { target: centre.clone(), radius: 6200, theta: 0.42, phi: 0.98 },
    follow: { ...FOLLOW_HOME },
    pov: { yaw: 0 },
    intro: null,
    cine: false, // the auto camera directs: slower, eased moves
    dolly: null, // { from, fromLook, t0, dur }: an eased move to the next shot
    spinSign: 1, pushFloor: 0,
  };
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
  const velPos = new THREE.Vector3(), velLook = new THREE.Vector3(), subject = new THREE.Vector3();
  let aspect = 1, fov = FOLLOW_HOME.fov, occlusionLift = 0;

  function overviewPose() {
    const portrait = aspect < 1;
    Object.assign(rig.orbit, { radius: portrait ? 8400 : 6400, theta: portrait ? 0.32 : 0.95, phi: portrait ? 0.95 : 1.04 });
    rig.orbit.target.copy(centre);
  }
  overviewPose();

  function setMode(mode, { instant = false } = {}) {
    if (mode === 'overview') overviewPose();
    if (mode === 'free' && rig.mode !== 'overview') {
      rig.orbit.target.copy(riders[rig.selected].pos);
      Object.assign(rig.orbit, { radius: 1100, phi: 0.9 });
    }
    if (mode === 'follow') rig.follow = { ...FOLLOW_HOME };
    rig.mode = mode;
    rig.intro = null;
    rig.dolly = null;
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
  const chaseDir = new THREE.Vector3(), probe = new THREE.Vector3();
  function desiredPose(now, dt) {
    const r = riders[rig.selected];
    if (rig.mode === 'follow' || rig.mode === 'pov') {
      const pov = rig.mode === 'pov', f = rig.follow;
      roadDir(currentD[rig.selected], chaseDir, pov ? 30 : 70);
      const target = Math.atan2(chaseDir.x, chaseDir.z);
      if (chaseHeading === null) chaseHeading = target;
      const delta = Math.atan2(Math.sin(target - chaseHeading), Math.cos(target - chaseHeading));
      chaseHeading += delta * Math.min(1, dt * (pov ? 2.4 : rig.cine ? 0.9 : 1.6));
      // A broadcast shot drifts: a slow orbit, a slow push in.
      if (!pov && f.spin) f.theta += f.spin * rig.spinSign * dt;
      if (!pov && f.push) f.radius = Math.max(rig.pushFloor, f.radius * Math.exp(f.push * dt));
      subject.copy(r.pos);
      if (!pov && f.group) { // the riders within 300 m of the road around this one
        let n = 1;
        riders.forEach((o, i) => { if (i !== rig.selected && Math.abs(currentD[i] - currentD[rig.selected]) < 300) { subject.add(o.pos); n++; } });
        subject.divideScalar(n);
      }
      // Rider view is a low, tight chase just over the shoulder; drag swings it sideways.
      const g = pov ? { theta: rig.pov.yaw, phi: 1.3, radius: 9 * RIDER_SCALE } : f;
      const place = (theta, out) => out.set(
        subject.x + g.radius * Math.sin(g.phi) * Math.sin(chaseHeading + Math.PI + theta),
        subject.y + g.radius * Math.cos(g.phi) + (pov ? 2.4 * RIDER_SCALE : 6),
        subject.z + g.radius * Math.sin(g.phi) * Math.cos(chaseHeading + Math.PI + theta));
      const ahead = pov ? 40 : f.ahead;
      wantLook.set(subject.x + Math.sin(chaseHeading) * ahead, subject.y + (pov ? 0.2 * RIDER_SCALE : f.lift), subject.z + Math.cos(chaseHeading) * ahead);
      if (pov) place(g.theta, wantPos);
      else {
        // Keep the riders in sight in the mountains: a ridge in the way first swings the camera
        // sideways (a clear line nearby keeps the low, cinematic angle), then lifts it over.
        if (now - swingAt > 400 && !pointers.size) {
          swingAt = now;
          let best = Infinity;
          for (const off of SWINGS) {
            const cost = liftFor(place(g.theta + off, probe)) + 260 * Math.abs(off) + (off === swingTarget ? -40 : 0);
            if (cost < best) { best = cost; swingTarget = off; }
          }
        }
        swing += (swingTarget - swing) * Math.min(1, dt * 0.7);
        place(g.theta + swing, wantPos);
        const need = liftFor(wantPos);
        occlusionLift += (need - occlusionLift) * Math.min(1, dt * (need > occlusionLift ? 3 : 0.7));
        wantPos.y += occlusionLift;
      }
      fovTarget = pov ? POV_FOV : f.fov ?? FOLLOW_HOME.fov;
    } else {
      if (rig.mode === 'overview' && now - rig.lastInput > 5000) rig.orbit.theta += 0.00004 * (now - lastNow);
      orbitPosition(rig.orbit, wantPos);
      wantLook.copy(rig.orbit.target);
      fovTarget = MAP_FOV;
    }
  }
  let fovTarget = FOLLOW_HOME.fov, swing = 0, swingTarget = 0, swingAt = -1e9;
  const SWINGS = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05], sight = new THREE.Vector3();
  // How far the camera at `pos` must rise for its line of sight to the subject to clear the ground.
  function liftFor(pos) {
    const sy = subject.y + 6;
    let need = 0;
    for (let s = 1; s <= 12; s++) {
      const k = s / 13;
      sight.lerpVectors(subject, pos, k);
      const clear = elevation(sight.x, sight.z) + 12, lineY = sy + (pos.y - sy) * k;
      if (clear > lineY) need = Math.max(need, sy + (clear - sy) / k - pos.y);
    }
    return need;
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
      start.clone().addScaledVector(dir0, -280).add(new THREE.Vector3(0, 190, 0)),
    ];
    const looks = [centre.clone(), P(1), P(0.48), P(0.12), start.clone().addScaledVector(dir0, 30)];
    rig.intro = {
      t0: performance.now(), duration, onProgress, onDone,
      pos: new THREE.CatmullRomCurve3(positions, false, 'centripetal'),
      look: new THREE.CatmullRomCurve3(looks, false, 'centripetal'),
    };
    rig.mode = 'follow';
    rig.follow = { ...FOLLOW_HOME };
  }
  function skipIntro() {
    if (!rig.intro) return;
    const done = rig.intro.onDone;
    rig.intro = null;
    rig.transitionUntil = performance.now() + 1400;
    done?.();
  }

  // ---- input --------------------------------------------------------------
  // Touch: one finger swiping vertically belongs to the page (the race sheet, via onPageDrag),
  // so the standings are always one swipe away; two fingers move the map. A sideways one-finger
  // swipe still turns the camera. Mouse and pen keep the full one-button map controls.
  // When the page declines the drag (no sheet to move), the swipe goes to the map as before.
  const pointers = new Map();
  let pinch = 0, mid = null, lastTap = 0, dragged = 0, touchAxis = null, touchStart = null, pageY = 0;
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const endPageDrag = phase => { if (touchAxis === 'y') onPageDrag?.(phase, pageY); touchAxis = 'map'; };
  canvas.addEventListener('pointerdown', e => {
    if (rig.intro) { skipIntro(); return; }
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    canvas.setPointerCapture(e.pointerId);
    dragged = 0;
    rig.lastInput = performance.now();
    if (pointers.size === 1) { touchAxis = e.pointerType === 'touch' ? null : 'map'; touchStart = [e.clientX, e.clientY]; }
    if (pointers.size === 2) {
      endPageDrag('end');
      const [a, b] = [...pointers.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const old = pointers.get(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    rig.lastInput = performance.now();
    const dx = e.clientX - old[0], dy = e.clientY - old[1];
    dragged += Math.abs(dx) + Math.abs(dy);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], dist = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (pinch) zoom(pinch / dist);
      if (mid && rig.mode !== 'follow' && rig.mode !== 'pov') pan(m[0] - mid[0], m[1] - mid[1]);
      else if (mid && e.pointerType === 'touch') rotate(m[0] - mid[0], m[1] - mid[1]);
      pinch = dist; mid = m;
      return;
    }
    if (touchAxis === null) {
      const tx = e.clientX - touchStart[0], ty = e.clientY - touchStart[1];
      if (Math.hypot(tx, ty) < 10) return;
      touchAxis = Math.abs(ty) > Math.abs(tx) ? 'y' : 'x';
      if (touchAxis === 'y' && !onPageDrag?.('start', pageY = touchStart[1])) touchAxis = 'map';
    }
    if (touchAxis === 'y') onPageDrag('move', pageY = e.clientY);
    else if (touchAxis === 'x') rotate(dx, 0);
    else if (e.shiftKey || e.buttons === 2) pan(dx, dy);
    else rotate(dx, dy);
  });
  const release = e => {
    if (!pointers.delete(e.pointerId)) return; // e.g. the tap that skipped the intro
    pinch = 0; mid = null;
    if (!pointers.size) endPageDrag(e.type === 'pointerup' ? 'end' : 'cancel');
    if (e.type === 'pointerup' && dragged < 8) {
      const now = performance.now();
      if (now - lastTap < 320) doubleTap(e);
      else tapRider(e);
      lastTap = now;
    }
  };
  // A tap within 32 px of a rider's body follows them, like a tap on their label.
  function tapRider(e) {
    const rect = canvas.getBoundingClientRect();
    let best = -1, bestD = 32;
    riders.forEach((r, i) => {
      project.copy(r.pos).y += 0.9 * RIDER_SCALE;
      project.project(camera);
      if (project.z >= 1) return;
      const d = Math.hypot((project.x * 0.5 + 0.5) * w - (e.clientX - rect.left), (-project.y * 0.5 + 0.5) * h - (e.clientY - rect.top));
      if (d < bestD) { best = i; bestD = d; }
    });
    if (best >= 0) onSelect(best);
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => { e.preventDefault(); if (rig.intro) return skipIntro(); rig.lastInput = performance.now(); zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });

  function rotate(dx, dy) {
    onUserCamera?.();
    if (rig.mode === 'follow') {
      rig.follow.theta -= dx * 0.006;
      rig.follow.phi = Math.max(0.35, Math.min(1.42, rig.follow.phi - dy * 0.005));
    } else if (rig.mode === 'pov') rig.pov.yaw = Math.max(-1.2, Math.min(1.2, rig.pov.yaw + dx * 0.004));
    else {
      rig.orbit.theta -= dx * 0.005;
      rig.orbit.phi = Math.max(0.12, Math.min(1.42, rig.orbit.phi - dy * 0.005));
    }
  }
  function zoom(f) {
    onUserCamera?.();
    if (rig.mode === 'follow') rig.follow.radius = Math.max(25, Math.min(1500, rig.follow.radius * f));
    else if (rig.mode === 'pov') { setMode('follow'); onModeChange?.('follow'); }
    else rig.orbit.radius = Math.max(120, Math.min(14000, rig.orbit.radius * f));
  }
  function pan(dx, dy) {
    onUserCamera?.();
    if (rig.mode === 'overview') { rig.mode = 'free'; onModeChange?.('free'); }
    const k = rig.orbit.radius * 0.0016, s = Math.sin(rig.orbit.theta), c = Math.cos(rig.orbit.theta);
    rig.orbit.target.x -= (dx * c + dy * s) * k;
    rig.orbit.target.z -= (-dx * s + dy * c) * k;
    rig.orbit.target.y = elevation(rig.orbit.target.x, rig.orbit.target.z);
  }
  function doubleTap(e) {
    onUserCamera?.();
    if (rig.mode === 'follow') { rig.follow = { ...FOLLOW_HOME }; return; }
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
  let onModeChange = null, onUserCamera = null;

  // A broadcast shot for the auto camera: one of the modes, or a follow-rig preset (`side` picks the left or right moto).
  // The camera moves to it in one slow eased dolly; a move across the map would be a fly-by, so that one is a cut
  // instead, and setShot returns 'cut' for the page to dip the picture.
  function setShot(shot, side = 1) {
    const from = camPos.clone(), fromLook = camLook.clone();
    if (!SHOTS[shot]) setMode(shot);
    else {
      setMode('follow');
      rig.follow = { ...SHOTS[shot], theta: SHOTS[shot].theta * side };
      rig.spinSign = side;
      rig.pushFloor = SHOTS[shot].radius * 0.6;
    }
    chaseHeading = null;
    occlusionLift = swing = swingTarget = 0; swingAt = -1e9;
    desiredPose(performance.now(), 0);
    velPos.set(0, 0, 0); velLook.set(0, 0, 0);
    if (from.distanceTo(wantPos) > 2200 && wantLook.distanceTo(fromLook) > 900) {
      camPos.copy(wantPos); camLook.copy(wantLook);
      fov = fovTarget;
      rig.transitionUntil = 0;
      return 'cut';
    }
    rig.dolly = { from, fromLook, t0: performance.now(), dur: 2800 + Math.min(1800, from.distanceTo(wantPos) * 0.8) };
    return 'dolly';
  }

  // Critically damped spring (no overshoot, no jerk): the camera glides to its target.
  const dv = new THREE.Vector3(), dt2 = new THREE.Vector3();
  function smoothDamp(cur, target, vel, smooth, dt) {
    const omega = 2 / smooth, x = omega * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    dv.subVectors(cur, target);
    dt2.copy(vel).addScaledVector(dv, omega).multiplyScalar(dt);
    vel.addScaledVector(dt2, -omega).multiplyScalar(e);
    cur.copy(target).add(dv.add(dt2).multiplyScalar(e));
  }

  // ---- frame ----------------------------------------------------------------
  const currentD = race.riders.map(() => 0);
  const labelOrder = () => race.riders.map((_, i) => i).sort((a, b) => (b === rig.selected) - (a === rig.selected) || currentD[b] - currentD[a]);
  const project = new THREE.Vector3(), trailP = new THREE.Vector3(), trailS = new THREE.Vector3();
  let lastNow = performance.now(), slowFrames = 0, frames = 0, w = 1, h = 1, insetRight = 0, lastKey = '', keepOutBottom = 0;
  const post = createPost(renderer, scene, camera, { quality: lite ? 'low' : 'high' });
  const sunAway = new THREE.Vector2(-SUN_DIR.x, -SUN_DIR.z).normalize();

  // A right-hand panel (desktop) covers part of the canvas: shift the centre of
  // projection so the subject sits in the middle of the visible area.
  function resize() {
    w = container.clientWidth; h = container.clientHeight;
    aspect = (w - insetRight) / h;
    camera.aspect = (w + insetRight) / h;
    if (insetRight) camera.setViewOffset(w + insetRight, h, insetRight, 0, w, h);
    else camera.clearViewOffset();
    applyFov();
    renderer.setSize(w, h, false);
    post.setSize(w, h);
    if (rig.mode === 'overview') overviewPose();
    // The title block sits over the top of the canvas; place names under it would print over the title.
    keepOutBottom = keepOut ? keepOut.getBoundingClientRect().bottom - container.getBoundingClientRect().top + 8 : 0;
  }
  // A portrait screen gets a taller field, so the horizontal framing stays close to landscape's.
  function applyFov() {
    camera.fov = fov * (aspect < 0.8 ? 1.3 : 1);
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  if (keepOut) resizeObserver.observe(keepOut);
  resize();

  function frame({ time, distances, playing, rate }) {
    const now = performance.now();
    const realDt = Math.min(0.1, (now - lastNow) / 1000);
    // Adaptive quality: if the phone cannot hold ~45 fps, drop the bloom first, then the pixel ratio.
    frames++;
    if (realDt > 0.024) slowFrames++;
    if (frames === 30) {
      if (slowFrames > 15 && !post.lower() && dpr > 0.75) { dpr = Math.max(0.75, dpr - (slowFrames > 25 ? 0.5 : 0.25)); renderer.setPixelRatio(dpr); resize(); }
      frames = slowFrames = 0;
    }
    const t = now / 1000;
    sky.material.uniforms.uTime.value = t;
    sea.material.uniforms.uTime.value = t;

    riders.forEach((r, i) => {
      const d = distances[i], moving = playing && d < len && d > 0;
      currentD[i] = d;
      roadDir(d, r.dir);
      const side = tmpA.crossVectors(r.dir, UP).normalize();
      roadPoint(d, r.pos, ROAD_LIFT).addScaledVector(side, r.lane * RIDER_SCALE);
      r.g.position.copy(r.pos);
      const yaw = Math.atan2(r.dir.x, r.dir.z);
      r.g.rotation.set(0, yaw, 0);
      r.body.rotation.x = -Math.asin(Math.max(-0.3, Math.min(0.3, r.dir.y)));
      if (moving) r.phase += realDt * Math.min(1.45 * rate, 2.3) * Math.PI * 2;
      if (moving || r.posedAt !== d) { pedal(r); r.posedAt = d; }
      // the contact shadow falls away from the sun (rotate the world direction into the rider's frame)
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      r.shadow.position.set((sunAway.x * cy - sunAway.y * sy) * 0.55, 0.02, (sunAway.x * sy + sunAway.y * cy) * 0.55);
      r.shadow.rotation.y = Math.atan2(sunAway.x * cy - sunAway.y * sy, sunAway.x * sy + sunAway.y * cy);

      const camDist = camera.position.distanceTo(r.pos), sel = i === rig.selected;
      r.g.visible = camDist < 3200; // LOD: far away the beam and label carry the rider, the jointed model is skipped
      r.puck.material.opacity = (sel ? 0.75 + 0.25 * Math.sin(t * 4) : 0.55) * Math.min(1, Math.max(0, (camDist - 60) / 200)); // a marker for wide shots, gone up close
      const bh = Math.max(18, camDist * (sel ? 0.1 : 0.07)), bw = Math.max(0.6, camDist * (sel ? 0.0022 : 0.0015));
      r.beam.position.copy(r.pos);
      r.beam.scale.set(bw, bh, bw);
      r.beam.material.uniforms.uAlpha.value = Math.min(0.9, camDist / 700) * (sel ? 1 : 0.65);
      r.beam.visible = !(rig.mode === 'pov' && i === rig.selected);

      const half = Math.max(0.9, Math.min(9, camDist * 0.002)), trailKey = `${d}:${half.toFixed(1)}`;
      // close up the trail would read as glowing paint on real asphalt: it fades in with distance
      r.trail.material.opacity = (sel ? 1 : 0.45) * Math.min(1, Math.max(0.12, (camDist - 60) / 450));
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
      fovTarget = 44;
      rig.intro.onProgress?.(u);
      if (u >= 1) skipIntro();
    } else {
      desiredPose(now, realDt);
      const dragging = pointers.size > 0;
      if (rig.dolly) {
        // An eased dolly to the live target, lifted a little mid-move like a crane.
        const u = Math.min(1, (now - rig.dolly.t0) / rig.dolly.dur), e = u * u * u * (u * (u * 6 - 15) + 10);
        camPos.lerpVectors(rig.dolly.from, wantPos, e);
        camPos.y += Math.sin(Math.PI * u) * Math.min(260, rig.dolly.from.distanceTo(wantPos) * 0.2);
        camLook.lerpVectors(rig.dolly.fromLook, wantLook, Math.min(1, e * 1.15));
        if (u >= 1 || dragging) { rig.dolly = null; velPos.set(0, 0, 0); velLook.set(0, 0, 0); }
      } else {
        const transition = now < rig.transitionUntil;
        const smooth = dragging ? 0.07 : transition ? 0.5 : rig.cine ? 0.8 : rig.mode === 'pov' ? 0.22 : rig.mode === 'follow' ? 0.32 : 0.28;
        smoothDamp(camPos, wantPos, velPos, smooth, realDt);
        smoothDamp(camLook, wantLook, velLook, smooth * 0.75, realDt);
        if (rig.mode === 'pov' && !dragging) rig.pov.yaw *= 1 - Math.min(1, realDt * 1.5);
      }
    }
    fov += (fovTarget - fov) * Math.min(1, realDt * (rig.dolly ? 1.2 : 2.5));
    if (Math.abs(camera.fov - fov * (aspect < 0.8 ? 1.3 : 1)) > 0.01) applyFov();
    camPos.y = Math.max(camPos.y, elevation(camPos.x, camPos.z) + (rig.mode === 'pov' ? 6 : 14));
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    camera.updateMatrixWorld();
    sky.position.copy(camera.position);
    sea.position.set(camera.position.x, 0, camera.position.z);
    if (corridor.update(camera.position, riders[rig.selected].pos, now) || sceneDirty) { lastKey = ''; sceneDirty = false; }
    trees?.update(camera);
    road.update(camera.position.distanceTo(riders[rig.selected].pos));
    if (camera.position.distanceTo(flag.cloth.position) < 3000) waveFlag(t);
    for (const b of kmBoards) {
      const d = camera.position.distanceTo(b.position);
      b.material.opacity = Math.min(1, (2400 - d) / 600) * Math.min(1, (d - 30) / 60);
      b.visible = b.material.opacity > 0.01;
    }

    // HTML labels follow their 3D anchors. Riders in a bunch would stack their labels into an
    // unreadable pile (on a phone, most of the time): the first label of a pile stands for it with "+N".
    // The selected rider claims its place first, then riders by position on the road.
    const placed = [];
    for (const i of labelOrder()) {
      const r = riders[i], sel = i === rig.selected;
      project.copy(r.pos).y += 2.2 * RIDER_SCALE;
      project.project(camera);
      const x = (project.x * 0.5 + 0.5) * w, y = (-project.y * 0.5 + 0.5) * h, width = sel ? 44 + 8 * race.riders[i].name.length : 34;
      let visible = project.z < 1 && Math.abs(project.x) < 1.05 && Math.abs(project.y) < 1.05;
      const host = visible && placed.find(p => Math.abs(p.x - x) < (p.width + width) / 2 + 2 && Math.abs(p.y - y) < 28);
      if (host) { host.more++; visible = false; }
      r.label.hidden = !visible;
      r.label.classList.toggle('sel', sel);
      r.label.style.zIndex = sel ? 3 : 2;
      if (!visible) continue;
      r.label.style.transform = `translate3d(${x}px,${y}px,0)`;
      placed.push({ r, x, y, width, more: 0 });
    }
    for (const p of placed) {
      const more = p.more ? `+${p.more}` : '';
      if (p.r.more.textContent !== more) { p.r.more.textContent = more; p.r.more.hidden = !more; }
    }
    for (const m of marks) {
      project.copy(m.p).project(camera);
      const visible = project.z < 1 && Math.abs(project.x) < 0.95 && Math.abs(project.y) < 0.95 && camera.position.distanceTo(m.p) > 250
        && (-project.y * 0.5 + 0.5) * h > keepOutBottom;
      m.el.hidden = !visible;
      if (visible) m.el.style.transform = `translate3d(${(project.x * 0.5 + 0.5) * w}px,${(-project.y * 0.5 + 0.5) * h}px,0)`;
    }
    for (const m of pins) {
      project.copy(m.p).project(camera);
      const visible = project.z < 1 && Math.abs(project.x) < 0.95 && Math.abs(project.y) < 0.95 && camera.position.distanceTo(m.p) < 4500;
      m.el.hidden = !visible;
      if (visible) m.el.style.transform = `translate3d(${(project.x * 0.5 + 0.5) * w}px,${(-project.y * 0.5 + 0.5) * h}px,0)`;
    }

    // Render on demand: a paused, settled view costs nothing.
    const key = `${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)},${camLook.x.toFixed(2)},${camLook.z.toFixed(2)},${camera.fov.toFixed(2)},${time},${rig.selected},${w},${h},${dpr},${post.quality}`;
    if (key !== lastKey || playing || rig.intro) { post.render(); lastKey = key; }
    lastNow = now;
  }

  // First frame: set the camera onto the overview so the first paint is not black.
  orbitPosition(rig.orbit, camPos); camLook.copy(rig.orbit.target);
  textureReady.then(() => { lastKey = ''; });

  return {
    frame, setMode, setShot, startIntro, skipIntro, addPin,
    // Ready once imagery is decoded and shaders are compiled (in parallel where the GPU allows).
    ready: textureReady.then(() => renderer.extensions.has('KHR_parallel_shader_compile') && renderer.compileAsync(scene, camera)).catch(() => {}),
    get introRunning() { return !!rig.intro; },
    select(i) { rig.selected = i; },
    setCinematic(on) { rig.cine = on; if (!on) rig.dolly = null; },
    onModeChange(fn) { onModeChange = fn; },
    onUserCamera(fn) { onUserCamera = fn; },
    setInsetRight(px) { if (px !== insetRight) { insetRight = px; resize(); } },
  };
}

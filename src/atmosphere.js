// Sky, haze and the world beyond the survey: one sky colour function feeds the
// sky dome, the fog on every lit object and the sea, so the horizon is seamless.
//
// Fog is aerial perspective with height falloff (thicker in the valleys), applied
// in linear light before tone mapping, through three's own fog chunks. It is
// patched once, at import, so every built-in material with `fog: true` gets it.
import * as THREE from 'three';

// The ride's own light (the riders' clips, 17 Oct, 10:20–12:20 local): sun SSE, ~38° up, bright and a little hazy.
export const SUN_DIR = new THREE.Vector3(0.27, 0.62, 0.74).normalize();
export const SUN_COLOR = new THREE.Color(1.0, 0.94, 0.86);
export const FAR_ALBEDO = new THREE.Color(0.078, 0.08, 0.058); // linear: average of the aerial imagery
const FOG_DENSITY = 1.7e-4, FOG_FALLOFF = 0.0011, FOG_BASE = 200; // per m; per m of height; reference height (m)

const f = v => v.toFixed(5);
const SKY_GLSL = `
const vec3 SUN_DIR = vec3(${f(SUN_DIR.x)}, ${f(SUN_DIR.y)}, ${f(SUN_DIR.z)});
vec3 skyColor(vec3 d) {
  float y = clamp(d.y, 0.0, 1.0), mu = max(dot(d, SUN_DIR), 0.0);
  vec3 c = mix(vec3(0.66, 0.71, 0.78), vec3(0.2, 0.34, 0.62), pow(y, 0.6));
  float low = 1.0 - smoothstep(0.0, 0.4, y);
  c *= mix(vec3(1.0), vec3(1.05, 1.0, 0.95), low * 0.5);     // a faint warm band low in the sky
  c += vec3(1.0, 0.88, 0.7) * (pow(mu, 5.0) * 0.25 * (0.35 + 0.65 * low) + pow(mu, 48.0) * 0.5);
  return c;
}
vec3 hazeColor(vec3 d) { return skyColor(normalize(vec3(d.x, max(d.y, 0.0) * 0.4 + 0.02, d.z))); }
vec3 applyFog(vec3 col, vec3 world) {
  vec3 ray = world - cameraPosition;
  float dist = length(ray), dy = ray.y;
  float k = ${f(FOG_FALLOFF)};
  float h = abs(k * dy) > 1e-3 ? (1.0 - exp(-k * dy)) / (k * dy) : 1.0;
  float optical = ${FOG_DENSITY.toExponential()} * exp(-k * (cameraPosition.y - ${FOG_BASE}.0)) * dist * h;
  return mix(col, hazeColor(ray / max(dist, 1e-3)), 1.0 - exp(-optical));
}
`;

// ---- patch three's fog chunks (once) ----------------------------------------
const C = THREE.ShaderChunk;
if (!C.tonemapping_fragment.includes('applyFog')) {
  C.fog_pars_vertex = '#ifdef USE_FOG\n varying vec3 vFogWorld;\n#endif';
  // world position from view space: view = R·world + t, so world = Rᵀ·(view − t)
  C.fog_vertex = '#ifdef USE_FOG\n vFogWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);\n#endif';
  C.fog_pars_fragment = `#ifdef USE_FOG\n uniform vec3 fogColor;\n varying vec3 vFogWorld;\n${SKY_GLSL}\n#endif`;
  C.fog_fragment = '';
  C.tonemapping_fragment = '#ifdef USE_FOG\n gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vFogWorld);\n#endif\n' + C.tonemapping_fragment;
}

// ---- noise for the far land ----------------------------------------------------
function hash(i, j) { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (hash(i, j) * (1 - u) + hash(i + 1, j) * u) * (1 - v) + (hash(i, j + 1) * (1 - u) + hash(i + 1, j + 1) * u) * v;
}
function ridged(x, y) {
  let a = 0.5, s = 0;
  for (let o = 0; o < 5; o++) { s += a * (1 - Math.abs(vnoise(x, y) * 2 - 1)); x *= 2.03; y *= 2.03; a *= 0.5; }
  return s;
}

export function createSky() {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(40000, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: `varying vec3 vDir; uniform float uTime;
      ${SKY_GLSL}
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        float mu = max(dot(d, SUN_DIR), 0.0);
        // fair-weather cumulus, as in the clips: white, brighter towards the sun
        if (d.y > 0.0) {
          vec2 p = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.004, 0.0);
          float n = vn(p) * 0.5 + vn(p * 2.1 + 3.7) * 0.3 + vn(p * 4.3 - 1.3) * 0.2;
          float cl = smoothstep(0.46, 0.78, n) * smoothstep(0.02, 0.3, d.y);
          c = mix(c, vec3(0.94, 0.95, 0.97) * (0.8 + 0.5 * pow(mu, 4.0)) * (0.82 + 0.25 * n), cl * 0.8);
        }
        c += vec3(1.0, 0.85, 0.6) * smoothstep(0.9993, 0.99965, mu) * 14.0; // sun disc (blooms)
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = 2; // last of the opaque pass: only the pixels nothing else covered
  return sky;
}

// The sea at 0 m, far beyond the survey: sky reflection, a sun glint, the same haze.
export function createSea() {
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(140000, 140000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying vec3 vW; uniform float uTime;
      ${SKY_GLSL}
      void main(){
        vec3 v = normalize(vW - cameraPosition);
        vec2 q = vW.xz * 0.004;
        vec3 n = normalize(vec3(sin(q.x * 3.0 + uTime * 0.6) * 0.02 + sin(q.y * 5.0 - uTime * 0.4) * 0.015, 1.0, cos(q.y * 4.0 + uTime * 0.5) * 0.02));
        vec3 r = reflect(v, n);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-v, n), 0.0), 5.0);
        vec3 c = mix(vec3(0.01, 0.045, 0.07), skyColor(vec3(r.x, abs(r.y), r.z)), fres);
        c += vec3(1.0, 0.75, 0.45) * pow(max(dot(r, SUN_DIR), 0.0), 220.0) * 3.0;
        gl_FragColor = vec4(applyFog(c, vW), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  sea.renderOrder = 1; // after the land that covers most of it
  return sea;
}

// The island beyond the survey: the survey's own edge heights carried outward into a
// coarse Tramuntana ridge (it runs SW–NE behind the climb), the sea past it to the NW
// and the plain to the SE. Low detail on purpose; the haze does the rest.
export function createFarLand({ width, depth, elevation }) {
  const N = 112, SPAN = 52000, hw = width / 2, hd = depth / 2;
  const g = new THREE.PlaneGeometry(1, 1, N, N).rotateX(-Math.PI / 2);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const warp = s => Math.sign(s) * Math.abs(s) ** 1.9; // dense near the survey, sparse far away
  for (let k = 0; k < pos.count; k++) {
    const x = warp(pos.getX(k) * 2) * SPAN / 2, z = warp(pos.getZ(k) * 2) * SPAN / 2;
    const cx = Math.max(-hw, Math.min(hw, x)), cz = Math.max(-hd, Math.min(hd, z));
    const out = Math.hypot(x - cx, z - cz);
    let y;
    if (out < 1) y = elevation(x, z) - 60; // under the survey mesh
    else {
      const s = (-x - z) / Math.SQRT2, t = (x - z) / Math.SQRT2; // s: towards NW (the coast), t: along the range
      const ridge = s < 3500 ? 120 + 880 * Math.exp(-(((s - 3500) / 3000) ** 2)) : 1000 * Math.exp(-(((s - 3500) / 2300) ** 2)) - 260 * Math.min(1, Math.max(0, (s - 5500) / 3000));
      const rough = ridged(x / 2600 + 11, z / 2600 - 7) * 0.9 + 0.1;
      const regional = ridge * (0.45 + 0.75 * rough) + (s > 7000 ? 0 : 20) + 8 * Math.sin(t / 900);
      const blend = Math.min(1, out / 3200), e = blend * blend * (3 - 2 * blend);
      y = elevation(cx, cz) * (1 - e) + regional * e;
      if (s > 6500 && y < 6) y = -25; // the sea covers it
    }
    pos.setXYZ(k, x, y, z);
    const shade = 0.85 + 0.3 * vnoise(x / 700, z / 700), rock = Math.min(1, Math.max(0, (y - 700) / 600));
    col[k * 3] = FAR_ALBEDO.r * shade * (1 + rock * 0.5);
    col[k * 3 + 1] = FAR_ALBEDO.g * shade * (1 + rock * 0.35);
    col[k * 3 + 2] = FAR_ALBEDO.b * shade * (1 + rock * 0.6);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

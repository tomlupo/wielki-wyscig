// Light and air: one sun, one atmosphere, shared by every surface so the far
// terrain, the sea and the sky meet at the horizon in the same colour.
//
// All colours here are linear HDR, before tone mapping. Three's own materials
// get the same fog through a patched fog chunk, applied before tone mapping.
import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(-0.78, 0.34, 0.52).normalize(); // low WSW late-afternoon sun
const v3 = v => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;

// Height fog with sun-side in-scattering (after Quilez): thick over the sea, thin over the ridges.
export const ATMOS_GLSL = `
  const vec3 SUN_DIR = ${v3(SUN_DIR)};
  const vec3 SUN_LIGHT = vec3(1.0, 0.80, 0.58) * 3.1;
  const vec3 SKY_LIGHT = vec3(0.42, 0.55, 0.78);
  const vec3 HAZE_BLUE = vec3(0.42, 0.56, 0.78);
  const vec3 HAZE_SUN = vec3(1.25, 0.86, 0.55);
  vec3 hazeColor(vec3 rd) {
    float s = max(dot(rd, SUN_DIR), 0.0);
    return mix(HAZE_BLUE, HAZE_SUN, pow(s, 5.0) * 0.85) * (0.92 + 0.12 * s);
  }
  vec3 atmos(vec3 col, vec3 wp) {
    vec3 d = wp - cameraPosition;
    float dist = length(d);
    vec3 rd = d / max(dist, 1e-3);
    const float A = 1.0 / 10500.0, B = 1.0 / 1150.0;
    float ry = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
    float tau = A / B * exp(-cameraPosition.y * B) * (1.0 - exp(-dist * ry * B)) / ry;
    float f = 1.0 - exp(-max(tau, 0.0));
    return mix(col, hazeColor(rd), f);
  }
`;

// Land colour by height and slope, like the Tramuntana: fields low, olive terraces, pine, limestone.
// The horizon grid uses it, and the survey imagery fades into it at its edges.
export const LAND_GLSL = `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
  vec3 landColor(vec3 wp, float slope) {
    float hgt = wp.y, k = noise(wp.xz * 0.0011) * 0.65 + noise(wp.xz * 0.0045) * 0.35;
    vec3 pine = vec3(0.045, 0.062, 0.03), olive = vec3(0.16, 0.15, 0.085), field = vec3(0.24, 0.19, 0.11);
    vec3 rock = vec3(0.36, 0.33, 0.29), sand = vec3(0.42, 0.37, 0.27);
    vec3 c = mix(field, olive, smoothstep(60.0, 260.0, hgt + k * 120.0));
    c = mix(c, pine, smoothstep(0.35, 0.75, k) * smoothstep(150.0, 450.0, hgt));
    c = mix(c, rock, clamp(smoothstep(0.22, 0.5, slope + k * 0.15) * smoothstep(250.0, 700.0, hgt) + smoothstep(950.0, 1250.0, hgt) * 0.6, 0.0, 1.0));
    return mix(sand, c, smoothstep(2.0, 14.0, hgt));
  }
`;

// Three's materials (road, riders, arches): fog in linear light, then tone mapping, like the custom shaders.
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying vec3 vFogWorld;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG\n varying vec3 vFogWorld;\n${ATMOS_GLSL}\n#endif`;
THREE.ShaderChunk.fog_fragment = '';
THREE.ShaderChunk.tonemapping_fragment = `#ifdef USE_FOG
  gl_FragColor.rgb = atmos(gl_FragColor.rgb, vFogWorld);
#endif
#if defined( TONE_MAPPING )
  gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`;

const TAIL = `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>`;

// Sky dome: zenith blue to a warm horizon, a bright sun disc (it blooms) and a soft glow around it.
export function createSky() {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(40000, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: `varying vec3 vDir;
      ${ATMOS_GLSL}
      void main(){
        vec3 rd = normalize(vDir);
        float h = max(rd.y, 0.0);
        vec3 c = mix(hazeColor(rd), vec3(0.10, 0.24, 0.55), pow(h, 0.42));
        float s = max(dot(rd, SUN_DIR), 0.0);
        c += vec3(1.0, 0.72, 0.42) * (pow(s, 12.0) * 0.45 + pow(s, 120.0) * 1.2);
        c += vec3(1.0, 0.9, 0.75) * smoothstep(0.99955, 0.99975, s) * 28.0;
        gl_FragColor = vec4(c, 1.0);
        ${TAIL}
      }`,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}

// The sea: a big plane at sea level, the sky reflected by Fresnel, a sun glitter path, slow waves.
export function createSea(uTime) {
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(240000, 240000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: { uTime },
    vertexShader: 'varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying vec3 vWorld; uniform float uTime;
      ${ATMOS_GLSL}
      ${LAND_GLSL}
      float waves(vec2 p){ return noise(p * 0.004 + uTime * 0.03) + 0.5 * noise(p * 0.011 - uTime * 0.05); }
      void main(){
        vec2 p = vWorld.xz;
        float n0 = waves(p), nx = waves(p + vec2(2.0, 0.0)), nz = waves(p + vec2(0.0, 2.0));
        vec3 n = normalize(vec3((n0 - nx) * 0.9, 1.0, (n0 - nz) * 0.9));
        vec3 v = normalize(vWorld - cameraPosition);
        vec3 r = reflect(v, n);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-v, n), 0.0), 5.0);
        vec3 c = mix(vec3(0.012, 0.05, 0.085), hazeColor(normalize(vec3(r.x, max(r.y, 0.02), r.z))) * 0.9, fres);
        c += SUN_LIGHT * pow(max(dot(r, SUN_DIR), 0.0), 260.0) * 6.0;
        gl_FragColor = vec4(atmos(c, vWorld), 1.0);
        ${TAIL}
      }`,
  }));
  sea.position.y = 0.5;
  return sea;
}

// The land beyond the survey: a coarse grid (public/horizon.json) in the shared land colour.
export function createHorizon(data, { width, depth, elevation }) {
  const { n, size } = data;
  const bytes = Uint8Array.from(atob(data.heights), c => c.charCodeAt(0));
  const h = new Int16Array(bytes.buffer);
  const geom = new THREE.PlaneGeometry(size, size, n - 1, n - 1).rotateX(-Math.PI / 2);
  const pos = geom.attributes.position;
  for (let k = 0; k < n * n; k++) {
    const x = pos.getX(k), z = pos.getZ(k);
    // Under the survey the grid sinks out of sight; outside it starts just below the survey's edge
    // (elevation() clamps to the edge) and reaches its own height 600 m out, so there is no step.
    const ox = Math.abs(x) - width / 2, oz = Math.abs(z) - depth / 2;
    if (ox < 0 && oz < 0) { pos.setY(k, elevation(x, z) - 80); continue; }
    const t = Math.min(1, Math.hypot(Math.max(0, ox), Math.max(0, oz)) / 600), e = t * t * (3 - 2 * t);
    pos.setY(k, elevation(x, z) * (1 - e) + h[k] * e - 4 * (1 - e));
  }
  geom.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vWorld; varying vec3 vN; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; vN = normal; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying vec3 vWorld; varying vec3 vN;
      ${ATMOS_GLSL}
      ${LAND_GLSL}
      void main(){
        if (vWorld.y < 0.0) discard; // the sea plane draws the water
        vec3 N = normalize(vN);
        vec3 c = landColor(vWorld, 1.0 - N.y);
        vec3 col = c * (SUN_LIGHT * max(dot(N, SUN_DIR), 0.0) + SKY_LIGHT * (0.55 + 0.45 * N.y) * 0.85);
        gl_FragColor = vec4(atmos(col, vWorld), 1.0);
        ${TAIL}
      }`,
  });
  return new THREE.Mesh(geom, mat);
}

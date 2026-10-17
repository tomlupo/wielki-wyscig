// The ground: the measured DEM refined into a finer mesh, plus a relief map baked once
// at four samples per DEM cell — per-pixel normals (hillshade), cast sun shadow and
// ambient occlusion in the valleys — so the hills read crisply from any distance.
import * as THREE from 'three';
import { SUN_DIR, FAR_ALBEDO } from './atmosphere.js';

const breathe = () => new Promise(resolve => setTimeout(resolve, 0));
const catmull = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

export async function buildTerrain({ terrain, renderer, lite }) {
  const { nx, ny, width, depth } = terrain;
  const bytes = Uint8Array.from(atob(terrain.heights), c => c.charCodeAt(0));
  const dem = Float32Array.from(new Uint16Array(bytes.buffer), v => v / 10);
  const D = (i, j) => dem[Math.min(ny - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];

  // Relief grid: R samples per DEM cell, bicubic (smooth slopes, no 31 m facets).
  const R = 4, RX = (nx - 1) * R + 1, RY = (ny - 1) * R + 1, fine = new Float32Array(RX * RY);
  const rows = new Float32Array(4);
  for (let j = 0; j < RY; j++) {
    if (j % 128 === 127) await breathe();
    const v = j / R, b = Math.floor(v), fy = v - b;
    for (let i = 0; i < RX; i++) {
      const u = i / R, a = Math.floor(u), fx = u - a;
      for (let r = 0; r < 4; r++) rows[r] = catmull(D(a - 1, b - 1 + r), D(a, b - 1 + r), D(a + 1, b - 1 + r), D(a + 2, b - 1 + r), fx);
      fine[j * RX + i] = catmull(rows[0], rows[1], rows[2], rows[3], fy);
    }
  }

  // Mesh: every M-th relief sample (2 per DEM cell; the full DEM grid on a weak GPU).
  const M = lite ? R : R / 2, MX = (nx - 1) * (R / M) + 1, MY = (ny - 1) * (R / M) + 1, mesh = new Float32Array(MX * MY);
  for (let j = 0; j < MY; j++) for (let i = 0; i < MX; i++) mesh[j * MX + i] = fine[j * M * RX + i * M];
  // Exact height of the rendered mesh (same triangle split as PlaneGeometry), so the road sits on it.
  function elevation(x, z) {
    const u = Math.max(0, Math.min(MX - 1.0001, (x / width + 0.5) * (MX - 1)));
    const v = Math.max(0, Math.min(MY - 1.0001, (z / depth + 0.5) * (MY - 1)));
    const a = Math.floor(u), b = Math.floor(v), fx = u - a, fy = v - b;
    const h = (i, j) => mesh[j * MX + i];
    if (fx + fy <= 1) return h(a, b) + (h(a + 1, b) - h(a, b)) * fx + (h(a, b + 1) - h(a, b)) * fy;
    return h(a + 1, b + 1) + (h(a, b + 1) - h(a + 1, b + 1)) * (1 - fx) + (h(a + 1, b) - h(a + 1, b + 1)) * (1 - fy);
  }
  const geom = new THREE.PlaneGeometry(width, depth, MX - 1, MY - 1);
  geom.rotateX(-Math.PI / 2);
  for (let k = 0; k < mesh.length; k++) geom.attributes.position.setY(k, mesh[k]);
  geom.computeBoundingSphere();
  await breathe();

  // Sun shadow and ambient occlusion on the DEM grid (cheap), upsampled into the relief map.
  const cellX = width / (nx - 1), cellZ = depth / (ny - 1);
  const sun = new Float32Array(nx * ny), ao = new Float32Array(nx * ny);
  let top = 0;
  for (const v of dem) top = Math.max(top, v);
  {
    const hl = Math.hypot(SUN_DIR.x, SUN_DIR.z), STEP = 1.5;
    const du = SUN_DIR.x / hl * STEP, dv = SUN_DIR.z / hl * STEP * cellX / cellZ, stepM = STEP * cellX, rise = SUN_DIR.y / hl * stepM;
    const bil = (u, v) => { const a = u | 0, b = v | 0, fx = u - a, fy = v - b, o = b * nx + a; return (dem[o] * (1 - fx) + dem[o + 1] * fx) * (1 - fy) + (dem[o + nx] * (1 - fx) + dem[o + nx + 1] * fx) * fy; };
    const DIRS = 8, REACH = [1, 2, 3, 5, 8, 12, 18, 27, 40];
    for (let j = 0; j < ny; j++) {
      if (j % 40 === 39) await breathe();
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i, h0 = dem[k] + 2;
        // soft cast shadow: the narrowest clearance of the ray to the sun
        let margin = 1, u = i, v = j, ray = h0;
        for (let s = 1; s < 160; s++) {
          u += du; v += dv; ray += rise;
          if (u < 0 || v < 0 || u >= nx - 1 || v >= ny - 1 || ray > top) break;
          margin = Math.min(margin, (ray - bil(u, v)) / (stepM * s));
          if (margin < -0.04) break;
        }
        sun[k] = Math.min(1, Math.max(0, (margin + 0.02) / 0.07));
        // ambient occlusion: mean horizon elevation over eight directions
        let occ = 0;
        for (let a = 0; a < DIRS; a++) {
          const ca = Math.cos(a * Math.PI / 4), sa = Math.sin(a * Math.PI / 4);
          let best = 0;
          for (const r of REACH) {
            const ii = Math.round(i + ca * r), jj = Math.round(j + sa * r);
            if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) break;
            const dist = Math.hypot(ca * r * cellX, sa * r * cellZ);
            best = Math.max(best, (dem[jj * nx + ii] - dem[k]) / dist);
          }
          occ += best / Math.sqrt(1 + best * best); // sin of the horizon angle
        }
        ao[k] = 1 - Math.min(1, occ / DIRS * 1.6);
      }
    }
  }
  await breathe();

  // Relief map: RG = world normal x/z, B = sun visibility, A = ambient occlusion.
  const relief = new Uint8Array(RX * RY * 4), sx = 2 * width / (RX - 1), sz = 2 * depth / (RY - 1);
  for (let j = 0; j < RY; j++) {
    if (j % 160 === 159) await breathe();
    const jm = Math.max(0, j - 1), jp = Math.min(RY - 1, j + 1), v = j / R, b = Math.min(ny - 2, v | 0), fy = v - b;
    for (let i = 0; i < RX; i++) {
      const im = Math.max(0, i - 1), ip = Math.min(RX - 1, i + 1);
      const gx = (fine[j * RX + ip] - fine[j * RX + im]) / sx, gz = (fine[jp * RX + i] - fine[jm * RX + i]) / sz;
      const inv = 1 / Math.hypot(gx, 1, gz), o = (j * RX + i) * 4;
      relief[o] = Math.round((-gx * inv * 0.5 + 0.5) * 255);
      relief[o + 1] = Math.round((-gz * inv * 0.5 + 0.5) * 255);
      const u = i / R, a = Math.min(nx - 2, u | 0), fx = u - a, q = b * nx + a;
      const lerp2 = f => (f[q] * (1 - fx) + f[q + 1] * fx) * (1 - fy) + (f[q + nx] * (1 - fx) + f[q + nx + 1] * fx) * fy;
      relief[o + 2] = Math.round(lerp2(sun) * 255);
      relief[o + 3] = Math.round(lerp2(ao) * 255);
    }
  }
  const reliefTex = new THREE.DataTexture(relief, RX, RY, THREE.RGBAFormat);
  reliefTex.magFilter = THREE.LinearFilter;
  reliefTex.minFilter = THREE.LinearMipmapLinearFilter;
  reliefTex.generateMipmaps = true;
  reliefTex.needsUpdate = true;

  const material = new THREE.MeshLambertMaterial({ color: 0x8d8a74 });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      uRelief: { value: reliefTex }, uSize: { value: new THREE.Vector2(width, depth) }, uFar: { value: FAR_ALBEDO },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGround;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGround; uniform sampler2D uRelief; uniform vec2 uSize; uniform vec3 uFar;
        vec4 relief; float camDist;
        float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `
        vec2 tuv = vGround.xz / uSize + 0.5;
        relief = texture2D(uRelief, tuv);
        camDist = length(vViewPosition);
        #ifdef USE_MAP
          // a warm, punchy grade (the haze softens the distance)
          vec3 tex = texture2D(map, vMapUv).rgb;
          float lum = dot(tex, vec3(0.2126, 0.7152, 0.0722));
          tex = mix(vec3(lum), tex, 1.45);
          tex = pow(max(tex, 0.0), vec3(1.1)) * 1.25 * vec3(1.07, 1.0, 0.88);
          diffuseColor.rgb *= tex;
        #endif
        float near = 1.0 - smoothstep(120.0, 1100.0, camDist);
        float grain = vnoise(vGround.xz * 0.31) * 0.5 + vnoise(vGround.xz * 1.1) * 0.3 + vnoise(vGround.xz * 0.08) * 0.2;
        diffuseColor.rgb *= mix(1.0, 0.82 + 0.36 * grain, near);
        // the survey's edges dissolve into the far land
        vec2 edgeM = min(tuv, 1.0 - tuv) * uSize;
        diffuseColor.rgb = mix(uFar, diffuseColor.rgb, smoothstep(0.0, 900.0, min(edgeM.x, edgeM.y)));`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        vec3 wn = vec3(relief.r * 2.0 - 1.0, 0.0, relief.g * 2.0 - 1.0);
        float n0 = vnoise(vGround.xz * 0.12), nk = near * 0.22;
        wn.xz += nk * vec2(vnoise(vGround.xz * 0.12 + vec2(0.7, 0.0)) - n0, vnoise(vGround.xz * 0.12 + vec2(0.0, 0.7)) - n0);
        wn.y = sqrt(max(0.04, 1.0 - dot(wn.xz, wn.xz)));
        normal = normalize((viewMatrix * vec4(normalize(wn), 0.0)).xyz);
        nonPerturbedNormal = normal;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        float occl = relief.a;
        reflectedLight.directDiffuse *= relief.b * mix(0.7, 1.0, occl);
        reflectedLight.indirectDiffuse *= mix(0.3, 1.05, occl * occl);`);
  };

  const ground = new THREE.Mesh(geom, material);
  const textureReady = new Promise(resolve => new THREE.TextureLoader().load(terrain.texture, texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    material.map = texture; material.color.set(0xffffff); material.needsUpdate = true;
    resolve();
  }, undefined, () => resolve()));
  return { ground, elevation, textureReady, top };
}

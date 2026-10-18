// Sharp imagery along the road: 25 cm PNOA tiles (scripts/build_terrain.py) over the ~4.75 m
// survey texture. The ground shader has SLOTS tile samplers; the tiles nearest the camera and
// the rider it watches fill them as they load, the rest of the land keeps the survey photo.
import * as THREE from 'three';

export const SLOTS = 12;
const REACH = 1400; // m: tiles further than this from both the camera and its subject are not worth a slot

// The ground shader is compiled before the tile index arrives: the uniforms exist from the start,
// the tiles from setIndex().
export function createCorridor({ renderer, hi }) {
  let T = 256, tiles = [];
  const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  blank.needsUpdate = true;
  // Uniforms the ground shader reads: per slot the tile's corner (x0, z0) and whether it is live.
  const uniforms = {
    uTile: { value: Array.from({ length: SLOTS }, () => blank) },
    uTileXZ: { value: Array.from({ length: SLOTS }, () => new THREE.Vector3()) },
    uTileSize: { value: T },
  };
  const slotOf = new Map(); // tile key → slot
  const loader = new THREE.TextureLoader();
  let width = 0, depth = 0, wanted = [], lastKey = '', dirty = false;

  function corner(t) { return [-width / 2 + t.i * T, -depth / 2 + t.j * T]; }
  function load(t) {
    t.loading = true;
    loader.load(`/corridor/${hi ? 'hi' : 'lo'}/${t.key}.webp`, tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false; // row 0 is the tile's north edge, which is its smallest z
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      t.tex = tex; t.loading = false;
      assign();
    }, undefined, () => { t.loading = false; });
  }
  // Put loaded wanted tiles into slots; free slots of tiles no longer wanted.
  function assign() {
    dirty = true;
    const keep = new Set(wanted.map(t => t.key));
    for (const [key, s] of slotOf) if (!keep.has(key)) { slotOf.delete(key); uniforms.uTileXZ.value[s].z = 0; uniforms.uTile.value[s] = blank; }
    const free = [];
    for (let s = 0; s < SLOTS; s++) if (![...slotOf.values()].includes(s)) free.push(s);
    for (const t of wanted) {
      if (!t.tex || slotOf.has(t.key) || !free.length) continue;
      const s = free.shift(), [x0, z0] = corner(t);
      slotOf.set(t.key, s);
      uniforms.uTile.value[s] = t.tex;
      uniforms.uTileXZ.value[s].set(x0, z0, 1);
    }
    // Keep at most twice the slots in memory: drop the longest-unused textures.
    const held = tiles.filter(t => t.tex && !keep.has(t.key)).sort((a, b) => a.used - b.used);
    for (const t of held.slice(0, Math.max(0, held.length - SLOTS))) { t.tex.dispose(); t.tex = null; }
  }

  return {
    uniforms,
    setIndex(index, w, d) {
      T = uniforms.uTileSize.value = index.tile;
      tiles = index.tiles.map(([i, j]) => ({ i, j, key: `${i}_${j}`, tex: null, loading: false, used: 0 }));
      width = w; depth = d; lastKey = '';
    },
    // Called every frame with the camera and the point it watches; cheap unless the wanted set changes.
    // True when the picture changed (a tile arrived or left), so a paused view redraws.
    update(camera, subject, now) {
      const changed = () => { const d = dirty; dirty = false; return d; };
      const score = t => {
        const [x0, z0] = corner(t), cx = x0 + T / 2, cz = z0 + T / 2;
        // the camera's own ground counts double: what is under the lens is seen largest
        return Math.min(Math.hypot(cx - camera.x, cz - camera.z) * 0.5 + 60, Math.hypot(cx - subject.x, cz - subject.z));
      };
      const ranked = tiles.map(t => ({ t, s: score(t) })).filter(r => r.s < REACH).sort((a, b) => a.s - b.s).slice(0, SLOTS).map(r => r.t);
      const key = ranked.map(t => t.key).join();
      if (key === lastKey) return changed();
      lastKey = key;
      wanted = ranked;
      for (const t of wanted) { t.used = now; if (!t.tex && !t.loading) load(t); }
      assign();
      return changed();
    },
    // Offline rendering (src/reel): a tile is still on its way, so a frame can wait until the ground is sharp.
    pending() { return tiles.some(t => t.loading); },
  };
}

// GLSL for the ground's map step: the colour of the sharp tile under this fragment, if one is live.
// textureGrad with the gradients taken outside the branches keeps mip selection right.
export const corridorGLSL = `
  uniform sampler2D uTile[${SLOTS}]; uniform vec3 uTileXZ[${SLOTS}]; uniform float uTileSize;
  vec4 corridorColor(vec2 g) {
  #if __VERSION__ < 300
    return vec4(0.0); // WebGL1 has no textureGrad: the survey photo only
  #else
    vec2 gx = dFdx(g) / uTileSize, gy = dFdy(g) / uTileSize;
    vec4 c = vec4(0.0);
    ${Array.from({ length: SLOTS }, (_, i) => `
    if (c.a == 0.0 && uTileXZ[${i}].z > 0.5) {
      vec2 tu = (g - uTileXZ[${i}].xy) / uTileSize;
      if (tu.x >= 0.0 && tu.y >= 0.0 && tu.x < 1.0 && tu.y < 1.0) c = vec4(textureGrad(uTile[${i}], tu, gx, gy).rgb, 1.0);
    }`).join('')}
    return c;
  #endif
  }`;

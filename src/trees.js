// Trees along the road, standing where the 25 cm photo shows a crown (scripts/build_terrain.py):
// Aleppo pines (dark, umbrella crowns on a bare trunk), holm oaks and olives (round, lighter)
// and low scrub. Real size, unlike the riders. One instanced mesh per kind per corridor tile,
// so whole tiles drop out with distance and the frustum.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// A lumpy crown: an icosphere pushed in and out by a hash of each vertex (shared vertices move together),
// smooth-shaded, darker underneath where the foliage shades itself.
function crownGeometry(detail, sy, seed) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, detail).deleteAttribute('normal').deleteAttribute('uv'));
  const p = g.attributes.position, colors = new Float32Array(p.count * 3);
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453;
    const f = 0.78 + 0.4 * (h - Math.floor(h));
    p.setXYZ(k, x * f, y * f * sy, z * f);
    const shade = 0.7 + 0.3 * (y * 0.5 + 0.5);
    colors.set([shade, shade, shade], k * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

const KINDS = [
  { // Aleppo pine: tall trunk, flat-topped crown
    crown: () => crownGeometry(1, 0.55, 1), unitH: 1.15, trunk: true,
    height: r => 1.7 * r + 2.2, crownH: r => 1.25 * r, colors: [0x1a2511, 0x202b14, 0x161f0f, 0x253217],
  },
  { // holm oak / olive: round crown close to the ground
    crown: () => crownGeometry(1, 0.8, 2), unitH: 1.7, trunk: false,
    height: r => 1.7 * r + 1, crownH: r => 1.5 * r, colors: [0x263214, 0x2f3b18, 0x212b12, 0x414823],
  },
  { // low scrub (lentisc, carritx)
    crown: () => crownGeometry(0, 0.6, 3), unitH: 1.3, trunk: false,
    height: r => 1.1 * r, crownH: r => 1.1 * r, colors: [0x464729, 0x3d4122, 0x525030],
  },
];

export async function buildTrees({ index, terrain, elevation, lite, phone }) {
  const breathe = () => new Promise(resolve => setTimeout(resolve, 0));
  const T = index.tile, { width, depth } = terrain;
  const group = new THREE.Group();
  const stride = lite ? 3 : phone ? 2 : 1; // a phone draws every second tree, a weak one every third
  // Bucket by corridor tile.
  const buckets = new Map();
  const t = index.trees;
  for (let k = 0, n = 0; k < t.length; k += 4, n++) {
    if (n % stride) continue;
    const x = t[k] / 10, z = t[k + 1] / 10, i = Math.floor((x + width / 2) / T), j = Math.floor((z + depth / 2) / T);
    const key = `${i}_${j}`;
    if (!buckets.has(key)) buckets.set(key, [[], [], []]);
    buckets.get(key)[t[k + 3]].push(x, z, t[k + 2] / 10);
  }
  const crowns = KINDS.map(K => K.crown());
  const trunkGeom = new THREE.CylinderGeometry(0.16, 0.26, 1, 5, 1, true).translate(0, 0.5, 0);
  // a faint glow through the foliage: lit leaves are never as dark as a solid's shaded side
  const crownMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x222a14 });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3f33 });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  let seed = 1;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const chunks = [];
  for (const [key, lists] of buckets) {
    if (chunks.length % 6 === 5) await breathe(); // builds while the race plays
    const [i, j] = key.split('_').map(Number), centre = new THREE.Vector3(-width / 2 + (i + 0.5) * T, 0, -depth / 2 + (j + 0.5) * T);
    centre.y = elevation(centre.x, centre.z);
    const meshes = [];
    lists.forEach((list, kind) => {
      const n = list.length / 3;
      if (!n) return;
      const K = KINDS[kind];
      const crown = new THREE.InstancedMesh(crowns[kind], crownMat, n);
      const trunk = K.trunk ? new THREE.InstancedMesh(trunkGeom, trunkMat, n) : null;
      for (let s = 0; s < n; s++) {
        const x = list[s * 3], z = list[s * 3 + 1], r = list[s * 3 + 2] * (0.62 + 0.36 * rand()); // a little under the detected crown: gaps let the ground show
        const y = elevation(x, z) - 0.3, h = K.height(r), ch = K.crownH(r);
        // a turn, a slight lean and an uneven crown: no two trees alike
        q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.16, rand() * Math.PI * 2, (rand() - 0.5) * 0.16));
        pos.set(x, y + h - ch * 0.5, z); scl.set(r, ch / K.unitH, r * (0.85 + 0.3 * rand()));
        crown.setMatrixAt(s, m4.compose(pos, q, scl));
        col.setHex(K.colors[(rand() * K.colors.length) | 0]); // setHex already converts sRGB to linear
        crown.setColorAt(s, col);
        if (trunk) {
          pos.set(x, y, z); scl.set(r * 0.28, h - ch * 0.6, r * 0.28);
          trunk.setMatrixAt(s, m4.compose(pos, q, scl));
        }
      }
      crown.computeBoundingSphere();
      meshes.push(crown);
      if (trunk) { trunk.computeBoundingSphere(); meshes.push(trunk); }
    });
    for (const m of meshes) group.add(m);
    chunks.push({ centre, meshes });
  }
  const far = phone ? 800 : 1400;
  return {
    group,
    count: t.length / 4 / stride,
    // Whole tiles drop out beyond `far` from the camera (the photo already shows the crowns from afar).
    update(camera) {
      for (const c of chunks) {
        const show = c.centre.distanceTo(camera.position) < far;
        for (const m of c.meshes) m.visible = show;
      }
    },
  };
}

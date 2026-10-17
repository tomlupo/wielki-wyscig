// Post-processing for the "high" preset: the scene renders to a linear HDR target,
// a cheap bloom (threshold at half size, a 4-level down/up blur chain) adds glow
// to the sun, the sea glitter, the route ribbon and the riders' trails, and the
// composite applies ACES tone mapping and sRGB on the way to the screen.
// Cost: one extra full-screen pass plus small passes at 1/2 to 1/16 size.
import * as THREE from 'three';

const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export function createPost(renderer) {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);

  const hdr = { type: THREE.HalfFloatType, depthBuffer: false };
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const levels = [0, 1, 2, 3].map(() => new THREE.WebGLRenderTarget(1, 1, hdr));
  const texel = new THREE.Vector2();

  const material = (fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false, ...extra });
  // Soft-knee threshold with a 4-tap box at half size.
  const bright = material(`varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
    void main(){
      vec3 c = (texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
              + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25;
      float l = max(c.r, max(c.g, c.b));
      const float T = 1.1, KNEE = 0.6;
      float s = clamp(l - T + KNEE, 0.0, 2.0 * KNEE); s = s * s / (4.0 * KNEE);
      c *= max(s, l - T) / max(l, 1e-4);
      gl_FragColor = vec4(min(c, vec3(40.0)), 1.0);
    }`, { tSrc: { value: null }, uTexel: { value: texel } });
  // Dual-filter (Kawase) blur: 5 taps going down, 8 taps going up, added onto the level above.
  const down = material(`varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
    void main(){
      vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
      c += texture2D(tSrc, vUv - uTexel).rgb + texture2D(tSrc, vUv + uTexel).rgb;
      c += texture2D(tSrc, vUv + vec2(uTexel.x, -uTexel.y)).rgb + texture2D(tSrc, vUv - vec2(uTexel.x, -uTexel.y)).rgb;
      gl_FragColor = vec4(c / 8.0, 1.0);
    }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const up = material(`varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
    void main(){
      vec2 o = uTexel;
      vec3 c = texture2D(tSrc, vUv + vec2(-o.x * 2.0, 0.0)).rgb + texture2D(tSrc, vUv + vec2(o.x * 2.0, 0.0)).rgb
             + texture2D(tSrc, vUv + vec2(0.0, -o.y * 2.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, o.y * 2.0)).rgb;
      c += (texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb
          + texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb) * 2.0;
      gl_FragColor = vec4(c / 12.0, 1.0);
    }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, { blending: THREE.AdditiveBlending, transparent: true });
  // Tone mapping and sRGB come from three's chunks (renderer.toneMapping = ACES when drawing to the screen).
  const composite = material(`varying vec2 vUv; uniform sampler2D tScene, tBloom; uniform float uBloom;
    void main(){
      vec3 c = texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * uBloom;
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`, { tScene: { value: sceneRT.texture }, tBloom: { value: levels[0].texture }, uBloom: { value: 0.32 } }, { toneMapped: true });

  function pass(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  }

  return {
    setSize(w, h) {
      sceneRT.setSize(w, h);
      levels.forEach((rt, i) => rt.setSize(Math.max(1, Math.round(w / 2 ** (i + 1))), Math.max(1, Math.round(h / 2 ** (i + 1)))));
    },
    render(world, view) {
      renderer.setRenderTarget(sceneRT);
      renderer.render(world, view);
      texel.set(1 / sceneRT.width, 1 / sceneRT.height);
      bright.uniforms.tSrc.value = sceneRT.texture;
      pass(bright, levels[0]);
      for (let i = 1; i < levels.length; i++) {
        down.uniforms.tSrc.value = levels[i - 1].texture;
        down.uniforms.uTexel.value.set(1 / levels[i - 1].width, 1 / levels[i - 1].height);
        pass(down, levels[i]);
      }
      for (let i = levels.length - 1; i > 0; i--) {
        up.uniforms.tSrc.value = levels[i].texture;
        up.uniforms.uTexel.value.set(0.5 / levels[i].width, 0.5 / levels[i].height);
        renderer.autoClear = false;
        pass(up, levels[i - 1]);
        renderer.autoClear = true;
      }
      pass(composite, null);
    },
    dispose() { sceneRT.dispose(); levels.forEach(rt => rt.dispose()); },
  };
}

// Post-processing with a quality ladder. "high": HDR scene → soft bloom on highlights
// (sun, glowing road, rider pucks) → ACES tone mapping. "low": the same scene drawn
// straight to the screen, tone-mapped by the renderer (the fog is applied in linear
// light either way, so both look alike, minus the glow). The vignette and the
// letterbox are CSS, so they cost nothing.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export function createPost(renderer, scene, camera, { quality = 'high' } = {}) {
  let composer = null, bloom = null, size = [1, 1];
  function build() {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: renderer.capabilities.isWebGL2 ? 4 : 0 });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.55, 0.9);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(...size);
  }
  if (quality === 'high') build();
  return {
    get quality() { return composer ? 'high' : 'low'; },
    setSize(w, h) { size = [w, h]; if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); } },
    render() { composer ? composer.render() : renderer.render(scene, camera); },
    // The first step down the ladder when a phone cannot keep up.
    lower() { if (!composer) return false; composer.dispose(); composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); composer = bloom = null; return true; },
  };
}

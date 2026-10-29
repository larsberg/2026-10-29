import { Fog, HalfFloatType, WebGLRenderTarget } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export function configureSceneFog(scene, { enabled, color, near, far }) {
  if (!enabled) { scene.fog = null; return; }
  scene.fog ??= new Fog(color, near, far);
  scene.fog.color.set(color);
  scene.fog.near = near;
  scene.fog.far = far;
}

// AO depth contains the opaque surfaces on layer 1. Transparent info and
// guides stay out of it. Beauty rendering keeps every layer.
export class SurfaceGTAOPass extends GTAOPass {
  _overrideVisibility() {
    // Hiding a LineSegments parent also hides its solid mesh children. Use
    // the AO layer mask to exclude guides without hiding their descendants.
    this.guideLayers = [];
    this.scene.traverse(object => {
      if (object.isPoints || object.isLine || object.isLine2) {
        this.guideLayers.push([object, object.layers.mask]); object.layers.disable(1);
      }
    });
  }
  _restoreVisibility() {
    for (const [object, mask] of this.guideLayers) object.layers.mask = mask;
    this.guideLayers.length = 0;
  }
  // Keep beauty and text sharp; occlusion is a soft, half-resolution signal.
  setSize(width, height) {
    super.setSize(Math.max(1, Math.ceil(width / 2)), Math.max(1, Math.ceil(height / 2)));
  }
  _renderOverride(renderer, overrideMaterial, ...args) {
    const swapped = [];
    if (overrideMaterial === this.normalMaterial) this.scene.traverse(object => {
      const normalMaterial = object.userData.aoNormalMaterial;
      if (!object.isMesh || !normalMaterial) return;
      const material = object.material;
      if (normalMaterial.flatShading !== material.flatShading || normalMaterial.side !== material.side) {
        normalMaterial.flatShading = material.flatShading; normalMaterial.side = material.side;
        normalMaterial.needsUpdate = true;
      }
      // allowOverride=false lets this mesh use its polygon-normal shader;
      // the floor and other meshes retain GTAO's standard override material.
      swapped.push([object, material]); object.material = normalMaterial;
    });
    try { super._renderOverride(renderer, overrideMaterial, ...args); }
    finally { for (const [object, material] of swapped) object.material = material; }
  }
  render(renderer, writeBuffer, readBuffer, ...args) {
    const mask = this.camera.layers.mask, autoShadow = renderer.shadowMap.autoUpdate;
    this.camera.layers.set(1);
    renderer.shadowMap.autoUpdate = false;
    try { super.render(renderer, writeBuffer, readBuffer, ...args); }
    finally { this.camera.layers.mask = mask; renderer.shadowMap.autoUpdate = autoShadow; }
  }
}

export function createSceneEffects(renderer, scene, camera, { clampBeauty = true } = {}) {
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: Math.min(2, renderer.capabilities.maxSamples) });
  const composer = new EffectComposer(renderer, target);
  const beauty = new RenderPass(scene, camera);
  const ao = new SurfaceGTAOPass(scene, camera, 1, 1, undefined,
    { radius: 0.6, thickness: 1.2, distanceExponent: 2, distanceFallOff: 1, scale: 1, samples: 16, screenSpaceRadius: false },
    { radius: 4, samples: 8 });
  // Keep the beauty buffer while GTAO produces its denoised occlusion texture.
  ao.output = GTAOPass.OUTPUT.Off;
  ao.needsSwap = false;
  const composite = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, tAO: { value: null }, strength: { value: 0.8 }, aoOnly: { value: false }, clampBeauty: { value: clampBeauty } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform sampler2D tDiffuse, tAO; uniform float strength; uniform bool aoOnly, clampBeauty; varying vec2 vUv;
      void main() {
        vec4 color = texture2D(tDiffuse, vUv);
        float occlusion = pow(clamp(texture2D(tAO, vUv).r, 0., 1.), strength);
        // The sketch deliberately has a bright, untone-mapped look. Clamp the
        // visible linear color before shading so highlights cannot erase AO.
        gl_FragColor = aoOnly ? vec4(vec3(occlusion), 1.) : vec4((clampBeauty ? min(color.rgb, vec3(1.)) : color.rgb) * occlusion, color.a);
      }`,
  });
  // ShaderPass clones uniforms; render-target textures must be assigned afterward.
  composite.uniforms.tAO.value = ao.gtaoMap;
  const output = new OutputPass();
  composer.addPass(beauty); composer.addPass(ao); composer.addPass(composite); composer.addPass(output);
  return {
    ao,
    configure(settings) {
      ao.enabled = settings.enabled && (settings.intensity > 0 || settings.aoOnly);
      composite.enabled = ao.enabled;
      composite.uniforms.strength.value = settings.aoOnly && settings.intensity === 0 ? 1 : settings.intensity;
      composite.uniforms.aoOnly.value = settings.aoOnly;
      ao.updateGtaoMaterial({ radius: settings.radius, thickness: Math.max(0.8, settings.radius * 2) });
    },
    resize(width, height) { composer.setSize(width, height); },
    // Keep color conversion and antialiasing identical when AO is toggled.
    render() { composer.render(); },
    dispose() { beauty.dispose(); ao.dispose(); composite.dispose(); output.dispose(); composer.dispose(); },
  };
}

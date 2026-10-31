import { DataTexture, Float32BufferAttribute, NearestFilter, RGBAFormat, RepeatWrapping, SRGBColorSpace, UnsignedByteType, Vector3 } from 'three';
import { createSeededRandom } from './mesh-layers.js';
import { defaultStudioColors, studioColorFields, studioColorKey } from './studio-palettes.js';

export const PROJECTED_LINE_COUNT = 16;
const HAT_OFFSET_DURATION = .05;

export const projectedLineFields = [
  ['enabled', 'Project lines', true],
  ['spacing', 'Line spacing', 1.25, .2, 8, .05],
  ['angle', 'Pattern angle °', 35, -180, 180, 1],
  ['tilt', 'Projection tilt °', 25, -75, 75, 1],
  ['offset', 'Pattern offset', 0, 0, 1, .01],
  ['offsetSpeed', 'Offset speed', .25, -1, 1, .001],
  ['strength', 'Pattern strength', 1, 0, 1, .01],
  ['seed', 'Color seed', 1, 0, 1000000, 1],
];
export const defaultProjectedLines = () => Object.fromEntries(projectedLineFields.map(([key, , value]) => [key, value]));

// One small, unfiltered palette texture serves the floor and every skin. Freeze
// the original world coordinates once so the pattern travels with deformation.
export function createProjectedLines(settings = defaultProjectedLines(), environment = defaultStudioColors()) {
  const size = PROJECTED_LINE_COUNT, pixels = new Uint8Array(size * 4);
  const texture = new DataTexture(pixels, size, 1, RGBAFormat, UnsignedByteType);
  texture.name = 'Projected lines · 16 palette bands';
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  const uniforms = {
    projectedLineMap: { value: texture },
    projectedLineAxis: { value: new Vector3() },
    projectedLineOffset: { value: 0 },
    projectedLineStrength: { value: 1 },
  };
  let textureKey, palette = environment;
  let baseOffset = 0, animatedOffset = 0, offsetSpeed = settings.offsetSpeed;
  let offsetFrom = 0, offsetTarget = 0, offsetElapsed = HAT_OFFSET_DURATION;
  const applyOffset = () => { uniforms.projectedLineOffset.value = (baseOffset + animatedOffset) % PROJECTED_LINE_COUNT; };
  function configure(value, nextPalette = palette) {
    palette = nextPalette;
    const nextKey = `${value.seed}:${studioColorKey(palette)}`;
    if (nextKey !== textureKey) {
      const colors = [...new Set(studioColorFields.map(([key]) => palette[key].toLowerCase()))];
      const random = createSeededRandom(value.seed);
      for (let x = 0; x < size; x++) {
        const hex = colors[Math.floor(random() * colors.length)], color = parseInt(hex.slice(1), 16);
        pixels.set([color >> 16, (color >> 8) & 255, color & 255, 255], x * 4);
      }
      texture.needsUpdate = true; textureKey = nextKey;
    }
    const radians = Math.PI / 180, angle = value.angle * radians;
    uniforms.projectedLineAxis.value.set(Math.cos(angle), Math.tan(value.tilt * radians), Math.sin(angle)).divideScalar(value.spacing);
    baseOffset = value.offset; offsetSpeed = value.offsetSpeed; applyOffset();
    uniforms.projectedLineStrength.value = value.enabled ? value.strength : 0;
  }
  function updateMotion(dt, events) {
    offsetElapsed = Math.min(HAT_OFFSET_DURATION, offsetElapsed + Math.max(0, dt));
    animatedOffset = offsetFrom + (offsetTarget - offsetFrom) * (offsetElapsed / HAT_OFFSET_DURATION);
    for (const event of events) if (event.layer === 'hat' && offsetSpeed !== 0) {
      offsetFrom = animatedOffset;
      offsetTarget += offsetSpeed;
      offsetElapsed = 0;
    }
    applyOffset();
  }
  function resetMotion() {
    animatedOffset = offsetFrom = offsetTarget = 0;
    offsetElapsed = HAT_OFFSET_DURATION; applyOffset();
  }
  function bind(material, { fixedOffset } = {}) {
    const previousCompile = material.onBeforeCompile, previousKey = material.customProgramCacheKey;
    const baseKey = previousKey.call(material);
    const offset = fixedOffset === undefined ? uniforms.projectedLineOffset : { value: fixedOffset };
    material.onBeforeCompile = function(shader, renderer) {
      previousCompile.call(this, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.uniforms.projectedLineOffset = offset;
      shader.vertexShader = 'attribute vec3 projectedLineRestPosition;\nvarying vec3 vProjectedLinePosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        #include <project_vertex>
        vProjectedLinePosition = projectedLineRestPosition;
      `);
      shader.fragmentShader = `
        uniform sampler2D projectedLineMap;
        uniform vec3 projectedLineAxis;
        uniform float projectedLineOffset, projectedLineStrength;
        varying vec3 vProjectedLinePosition;
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        if (projectedLineStrength > 0.0) {
          float coordinate = dot(vProjectedLinePosition, projectedLineAxis) + projectedLineOffset;
          vec3 pattern = texture2D(projectedLineMap, vec2(coordinate / ${PROJECTED_LINE_COUNT.toFixed(1)}, 0.5)).rgb;
          diffuseColor.rgb = mix(diffuseColor.rgb, pattern, projectedLineStrength);
        }
      `);
    };
    material.customProgramCacheKey = () => `${baseKey}:rest-world-palette-lines-v2`;
    material.needsUpdate = true;
    return () => {
      material.onBeforeCompile = previousCompile; material.customProgramCacheKey = previousKey;
      material.needsUpdate = true;
    };
  }
  function capture(mesh) {
    mesh.updateWorldMatrix(true, false);
    const position = mesh.geometry.attributes.position;
    const rest = new Float32BufferAttribute(new Float32Array(position.count * 3), 3), point = new Vector3();
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      rest.setXYZ(i, point.x, point.y, point.z);
    }
    mesh.geometry.setAttribute('projectedLineRestPosition', rest);
  }
  configure(settings);
  return { texture, uniforms, configure, updateMotion, resetMotion, bind, capture, dispose() { texture.dispose(); } };
}

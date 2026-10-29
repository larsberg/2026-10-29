import { ShaderChunk } from 'three';

// Three can reuse a material's cached program without calling onBeforeCompile.
// Keep its uniform alive across remeshing, and replace only the texture value.
const polygonNormalUniforms = new WeakMap();

// All corners in an n-gon read the same cyclic ring. Newell's area normal is
// evaluated in the vertex shader, then passed flat across every subtriangle.
// One small position texture and the existing draw call; no fragment loop,
// normal readback, CPU flat-normal rebuild, or extra rendering pass.
export function bindPolygonNormals(material, texture, sharedMix) {
  let uniforms = polygonNormalUniforms.get(material);
  if (!uniforms) {
    uniforms = { corners: { value: null }, normalMix: sharedMix ?? { value: material.userData.normalMix ?? 0 } };
    polygonNormalUniforms.set(material, uniforms);
  }
  const { corners, normalMix } = uniforms;
  corners.value = texture;
  const previousCompile = material.onBeforeCompile, previousKey = material.customProgramCacheKey;
  const baseKey = previousKey.call(material);
  material.onBeforeCompile = function(shader, renderer) {
    previousCompile.call(this, shader, renderer);
    shader.uniforms.dualCorners = corners;
    shader.uniforms.normalMix = normalMix;
    shader.vertexShader = `
      #ifdef FLAT_SHADED
      uniform sampler2D dualCorners;
      attribute vec2 polygonRange;
      flat out vec3 vPolygonNormal;
      varying vec3 vSmoothNormal;
      vec3 dualCorner(int index) {
        int width = textureSize(dualCorners, 0).x;
        return texelFetch(dualCorners, ivec2(index % width, index / width), 0).xyz;
      }
      vec3 polygonNormal() {
        int start = int(polygonRange.x), count = int(polygonRange.y);
        vec3 origin = dualCorner(start), area = vec3(0.0);
        vec3 previous = dualCorner(start + count - 1) - origin;
        for (int i = 0; i < count; i++) {
          vec3 current = dualCorner(start + i) - origin;
          area += cross(previous, current); previous = current;
        }
        return dot(area, area) > 1e-20 ? normalize(area) : normal;
      }
      #endif
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <defaultnormal_vertex>', `
      #include <defaultnormal_vertex>
      #ifdef FLAT_SHADED
        vSmoothNormal = normalize(transformedNormal);
        vPolygonNormal = normalMatrix * polygonNormal();
        #ifdef FLIP_SIDED
          vPolygonNormal = -vPolygonNormal;
        #endif
      #endif
    `);
    shader.fragmentShader = '#ifdef FLAT_SHADED\nuniform float normalMix;\nflat in vec3 vPolygonNormal;\nvarying vec3 vSmoothNormal;\n#endif\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>',
      ShaderChunk.normal_fragment_begin.replace(
        /vec3 fdx = dFdx\( vViewPosition \);\s*vec3 fdy = dFdy\( vViewPosition \);\s*vec3 normal = normalize\( cross\( fdx, fdy \) \);/,
        `vec3 flatNormal = normalize(vPolygonNormal);
        vec3 mixedNormal = mix(flatNormal, normalize(vSmoothNormal), normalMix);
        vec3 normal = dot(mixedNormal, mixedNormal) > 1e-20 ? normalize(mixedNormal) : flatNormal;
        #ifdef DOUBLE_SIDED
          normal *= faceDirection;
        #endif`));
  };
  material.customProgramCacheKey = () => `${baseKey}:dual-polygon-normal-mix-v2`;
  material.needsUpdate = true;
  return { normalMix, dispose() {
    if (corners.value === texture) corners.value = null;
    material.onBeforeCompile = previousCompile; material.customProgramCacheKey = previousKey;
    material.needsUpdate = true;
  } };
}


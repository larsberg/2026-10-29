import { Mesh, MeshStandardMaterial, PlaneGeometry, Vector2 } from 'three';
import { PROJECTED_LINE_COUNT } from './projected-lines.js';

export const GROUND_Y = 0;
const MAX_CENTROIDS = 11;

export function createHerdGround(scene, physics, settings, projection) {
  const material = new MeshStandardMaterial({ color: settings.color, roughness: settings.roughness, metalness: 0 });
  const centroids = Array.from({ length: MAX_CENTROIDS }, () => new Vector2());
  const sourceCount = { value: 0 };
  if (projection) {
    material.onBeforeCompile = shader => {
      shader.uniforms.projectedLineMap = projection.uniforms.projectedLineMap;
      shader.uniforms.projectedLineScale = projection.uniforms.projectedLineScale;
      shader.uniforms.projectedLineOffset = projection.uniforms.projectedLineOffset;
      shader.uniforms.projectedLineStrength = projection.uniforms.projectedLineStrength;
      shader.uniforms.groundCentroids = { value: centroids };
      shader.uniforms.groundCentroidCount = sourceCount;
      shader.vertexShader = 'varying vec2 vGroundPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        #include <project_vertex>
        vGroundPosition = (modelMatrix * vec4(transformed, 1.0)).xz;
      `);
      shader.fragmentShader = `
        uniform sampler2D projectedLineMap;
        uniform float projectedLineScale, projectedLineOffset, projectedLineStrength;
        uniform vec2 groundCentroids[${MAX_CENTROIDS}];
        uniform int groundCentroidCount;
        varying vec2 vGroundPosition;
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        if (projectedLineStrength > 0.0 && groundCentroidCount > 0) {
          float nearestSquared = 1e20;
          for (int i = 0; i < ${MAX_CENTROIDS}; i++) {
            if (i >= groundCentroidCount) break;
            vec2 delta = vGroundPosition - groundCentroids[i];
            nearestSquared = min(nearestSquared, dot(delta, delta));
          }
          // Point SDF (zero-radius circles): one square root after the union.
          float coordinate = sqrt(nearestSquared) * projectedLineScale + projectedLineOffset;
          vec3 pattern = texture2D(projectedLineMap, vec2(coordinate / ${PROJECTED_LINE_COUNT.toFixed(1)}, 0.5)).rgb;
          diffuseColor.rgb = mix(diffuseColor.rgb, pattern, projectedLineStrength);
        }
      `);
    };
    material.customProgramCacheKey = () => 'herd-centroid-distance-field-v2';
  }
  const mesh = new Mesh(new PlaneGeometry(2000, 2000), material);
  mesh.name = 'Herd ground'; mesh.rotation.x = -Math.PI / 2; mesh.position.y = GROUND_Y;
  mesh.receiveShadow = true; mesh.layers.enable(1); scene.add(mesh);
  const entry = physics.addBody({ body: { type: 'static', position: { x: 0, y: GROUND_Y - .5, z: 0 } },
    shapes: [{ type: 'box', halfExtents: { x: 1000, y: .5, z: 1000 } }] });
  return { mesh, entry,
    updateSources(views) {
      let count = 0;
      for (const view of views) {
        if (count === MAX_CENTROIDS) break;
        // One mass centroid per sculpture, projected into the floor's XZ plane.
        // Reading its few rigid hulls avoids traversing the deformed mesh.
        let mass = 0, x = 0, z = 0;
        for (const { body } of view.rig?.entries ?? []) {
          const weight = body.getMass(), center = body.getWorldCenterOfMass();
          mass += weight; x += center.x * weight; z += center.z * weight;
        }
        if (mass > 0) centroids[count++].set(x / mass, z / mass);
      }
      sourceCount.value = count;
    },
    configure(value) { material.color.set(value.color); material.roughness = value.roughness; },
    dispose() { physics.removeBody(entry); mesh.removeFromParent(); mesh.geometry.dispose(); material.dispose(); },
  };
}

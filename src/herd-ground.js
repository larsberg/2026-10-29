import { Mesh, MeshStandardMaterial, PlaneGeometry, Vector2 } from 'three';
import { PROJECTED_LINE_COUNT } from './projected-lines.js';

export const GROUND_Y = 0;
const MAX_COLLIDER_POINTS = 55; // Up to eleven bodies with five fitted hulls each.
const FOLLOW_DISTANCE = 250; // Recenter well inside the floor's 1,000-unit half-width.

export function createHerdGround(scene, physics, settings, projection) {
  const material = new MeshStandardMaterial({ color: settings.color, roughness: settings.roughness, metalness: 0 });
  const centroids = Array.from({ length: MAX_COLLIDER_POINTS }, () => new Vector2());
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
        uniform vec2 groundCentroids[${MAX_COLLIDER_POINTS}];
        uniform int groundCentroidCount;
        varying vec2 vGroundPosition;
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        if (projectedLineStrength > 0.0 && groundCentroidCount > 0) {
          float nearestSquared = 1e20;
          for (int i = 0; i < ${MAX_COLLIDER_POINTS}; i++) {
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
    material.customProgramCacheKey = () => 'herd-collider-distance-field-v1';
  }
  const mesh = new Mesh(new PlaneGeometry(2000, 2000), material);
  mesh.name = 'Herd ground'; mesh.rotation.x = -Math.PI / 2; mesh.position.y = GROUND_Y;
  mesh.receiveShadow = true; mesh.layers.enable(1); scene.add(mesh);
  const entry = physics.addBody({ body: { type: 'static', position: { x: 0, y: GROUND_Y - .5, z: 0 } },
    shapes: [{ type: 'box', halfExtents: { x: 1000, y: .5, z: 1000 } }] });
  // Foot plants need a stationary world reference when the collision floor moves.
  const anchor = physics.addBody({ body: { type: 'static', position: { x: 0, y: GROUND_Y - .5, z: 0 } } });
  return { mesh, entry, anchor,
    updateSources(views) {
      let count = 0;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const view of views) {
        if (count === MAX_COLLIDER_POINTS) break;
        // Each fitted hull contributes its own current center. Empty regions
        // have no collider and must not add phantom points to the field.
        for (const { body, shapes } of view.rig?.entries ?? []) {
          if (count === MAX_COLLIDER_POINTS) break;
          if (!shapes.length) continue;
          const center = body.getWorldCenterOfMass();
          centroids[count++].set(center.x, center.z);
          minX = Math.min(minX, center.x); maxX = Math.max(maxX, center.x);
          minZ = Math.min(minZ, center.z); maxZ = Math.max(maxZ, center.z);
        }
      }
      sourceCount.value = count;
      const position = entry.body.getPosition();
      if (count) {
        const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2;
        // Occasional horizontal shifts avoid updating the static broadphase on
        // every frame. World-space texture coordinates make the move invisible.
        if (Math.abs(x - position.x) > FOLLOW_DISTANCE || Math.abs(z - position.z) > FOLLOW_DISTANCE) {
          position.x = x; position.z = z;
          entry.body.setTransform(position, entry.initial.rotation);
        }
      }
      mesh.position.set(position.x, GROUND_Y, position.z);
    },
    configure(value) { material.color.set(value.color); material.roughness = value.roughness; },
    dispose() { physics.removeBody(anchor); physics.removeBody(entry); mesh.removeFromParent(); mesh.geometry.dispose(); material.dispose(); },
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, ShaderLib } from 'three';
import { initPhysics, createPhysics } from '../src/physics.js';
import { createHerdGround } from '../src/herd-ground.js';
import { createProjectedLines } from '../src/projected-lines.js';
import { defaultMeshSetup } from '../src/mesh-settings.js';

await initPhysics();
function fixture() {
  const settings = defaultMeshSetup(), physics = createPhysics(settings.rigidBody);
  const projection = createProjectedLines(settings.lines), ground = createHerdGround(new Scene(), physics, settings.floor, projection);
  const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
  ground.mesh.material.onBeforeCompile(shader, {});
  return { settings, physics, projection, ground, shader, dispose() { ground.dispose(); projection.dispose(); physics.dispose(); } };
}

test('ground uses one XZ mass centroid per body and updates existing uniforms as bodies move or leave', () => {
  const { ground, shader, projection, dispose } = fixture();
  const part = (mass, position) => ({ body: { getMass: () => mass, getWorldCenterOfMass: () => position } });
  const views = Array.from({ length: 11 }, (_, i) => ({ rig: { entries: [
    part(3, { x: i * 10 + 2, y: 1, z: 6 }), part(1, { x: i * 10 + 10, y: 12, z: 2 }),
  ] } }));
  try {
    const points = shader.uniforms.groundCentroids.value, version = projection.texture.version, geometry = ground.mesh.geometry;
    for (const count of [1, 11, 3]) {
      ground.updateSources(views.slice(0, count));
      assert.equal(shader.uniforms.groundCentroidCount.value, count);
      for (let i = 0; i < count; i++) assert.deepEqual(points[i].toArray(), [i * 10 + 4, 5]);
    }
    for (const entry of views[0].rig.entries) {
      const p = entry.body.getWorldCenterOfMass(); p.x += 7; p.y += 50; p.z -= 4;
    }
    ground.updateSources([views[0]]);
    assert.deepEqual(points[0].toArray(), [11, 1], 'Centroids follow horizontal motion and ignore height.');
    assert.equal(shader.uniforms.groundCentroids.value, points, 'Reuse the point array instead of rebuilding data.');
    assert.equal(projection.texture.version, version); assert.equal(ground.mesh.geometry, geometry);
    ground.updateSources([{ rig: undefined }]);
    assert.equal(shader.uniforms.groundCentroidCount.value, 0, 'Removed or not-yet-generated bodies leave no active source.');
  } finally { dispose(); }
});

test('concentric ground bands share the palette, spacing and chord offset while retaining lighting', () => {
  const { settings, ground, shader, projection, physics, dispose } = fixture();
  try {
    assert.equal(ground.mesh.receiveShadow, true);
    assert.equal(ground.mesh.material.isMeshStandardMaterial, true);
    assert.equal(ground.mesh.material.envMap, null);
    assert.equal(shader.uniforms.projectedLineMap.value, projection.texture);
    assert.equal(shader.uniforms.projectedLineStrength, projection.uniforms.projectedLineStrength);
    assert.equal(shader.uniforms.projectedLineOffset, projection.uniforms.projectedLineOffset);
    for (const [angle, tilt] of [[0, 0], [47, -12], [-145, 75]]) {
      projection.configure({ ...settings.lines, spacing: 2, angle, tilt, offset: .7 });
      assert.equal(shader.uniforms.projectedLineScale.value, .5, 'Legacy angle and tilt settings do not affect radial spacing.');
    }
    projection.updateMotion(0, [{ layer: 'keys', beat: 4 }]); projection.updateMotion(.125, []);
    assert.ok(Math.abs(shader.uniforms.projectedLineOffset.value - .825) < 1e-12, 'The floor receives the same half-completed chord transition.');
    projection.updateMotion(.125, []);
    assert.ok(Math.abs(shader.uniforms.projectedLineOffset.value - .95) < 1e-12);
    assert.match(shader.fragmentShader, /sqrt\(nearestSquared\) \* projectedLineScale \+ projectedLineOffset/);
    assert.match(shader.fragmentShader, /nearestSquared = min\(nearestSquared, dot\(delta, delta\)\)/);
    assert.equal(physics.entries.length, 1, 'The floor keeps its original single static collider.');
  } finally { dispose(); }
});

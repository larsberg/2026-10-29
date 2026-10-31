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

test('ground follows each collider independently, supports 55 points, and excludes empty regions', () => {
  const { ground, shader, projection, dispose } = fixture();
  const part = (position, hasCollider = true) => ({ shapes: hasCollider ? [{}] : [], body: { getWorldCenterOfMass: () => position } });
  const views = Array.from({ length: 11 }, (_, i) => ({ rig: { entries: [
    ...Array.from({ length: 5 }, (_, j) => part({ x: i * 10 + j, y: j + 1, z: j * 2 })),
    part({ x: -999, y: 1, z: -999 }, false),
  ] } }));
  try {
    const points = shader.uniforms.groundCentroids.value, version = projection.texture.version, geometry = ground.mesh.geometry;
    for (const count of [1, 11, 3]) {
      ground.updateSources(views.slice(0, count));
      assert.equal(shader.uniforms.groundCentroidCount.value, count * 5);
      for (let i = 0; i < count; i++) for (let j = 0; j < 5; j++)
        assert.deepEqual(points[i * 5 + j].toArray(), [i * 10 + j, j * 2]);
    }
    const p = views[0].rig.entries[0].body.getWorldCenterOfMass(); p.x += 7; p.y += 50; p.z -= 4;
    ground.updateSources([views[0]]);
    assert.deepEqual(points[0].toArray(), [7, -4], 'Each point follows its collider horizontally and ignores height.');
    assert.deepEqual(points[1].toArray(), [1, 2], 'Moving one collider does not move the other points.');
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
    assert.ok(Math.abs(shader.uniforms.projectedLineOffset.value - 1.2) < 1e-12, 'The floor receives the same half-completed chord transition.');
    projection.updateMotion(.125, []);
    assert.ok(Math.abs(shader.uniforms.projectedLineOffset.value - 1.7) < 1e-12);
    assert.match(shader.fragmentShader, /sqrt\(nearestSquared\) \* projectedLineScale \+ projectedLineOffset/);
    assert.match(shader.fragmentShader, /nearestSquared = min\(nearestSquared, dot\(delta, delta\)\)/);
    assert.equal(physics.entries.length, 2, 'The floor has one collider and a stationary, shapeless foot anchor.');
    assert.equal(ground.entry.shapes.length, 1); assert.equal(ground.anchor.shapes.length, 0);
  } finally { dispose(); }
});

test('the floor and its collider follow long travel in either direction and return on reset', () => {
  const { ground, shader, projection, physics, dispose } = fixture();
  const body = physics.addBody({ body: { position: { x: 0, y: 3, z: 0 } },
    shapes: [{ type: 'box', halfExtents: { x: .5, y: .5, z: .5 } }] });
  const views = [{ rig: { entries: [body] } }];
  const geometry = ground.mesh.geometry, textureVersion = projection.texture.version;
  try {
    for (const [x, z] of [[300, 0], [2300, -1700], [-3500, 2700]]) {
      body.body.setTransform({ x, y: 3, z }, body.initial.rotation);
      body.body.setLinearVelocity({ x: 0, y: 0, z: 0 }); body.body.setAwake(true);
      ground.updateSources(views);
      assert.deepEqual(ground.mesh.position.toArray(), [x, 0, z]);
      assert.deepEqual(ground.entry.body.getPosition(), { x, y: -.5, z });
      for (let i = 0; i < 120; i++) { physics.step(1 / 60); ground.updateSources(views); }
      const landed = body.body.getPosition();
      assert.ok(Math.abs(landed.y - .5) < .03, 'The body lands beyond the original floor edge.');
      assert.deepEqual(shader.uniforms.groundCentroids.value[0].toArray(), [landed.x, landed.z]);
      assert.deepEqual(ground.mesh.position.toArray(), [x, 0, z], 'Small motions do not move the static floor every frame.');
    }
    assert.equal(ground.mesh.geometry, geometry); assert.equal(projection.texture.version, textureVersion);
    assert.equal(shader.uniforms.projectedLineOffset, projection.uniforms.projectedLineOffset);
    physics.reset(); ground.updateSources(views);
    assert.deepEqual(ground.mesh.position.toArray(), [0, 0, 0]);
    assert.deepEqual(ground.entry.body.getPosition(), { x: 0, y: -.5, z: 0 });
  } finally { dispose(); }
});

test('repositioning the floor preserves planted feet without applying a horizontal pull', () => {
  const { ground, physics, dispose } = fixture();
  const foot = physics.addBody({ body: { position: { x: 900, y: .5, z: 0 } },
    shapes: [{ type: 'box', halfExtents: { x: .5, y: .5, z: .5 } }] });
  const contact = { x: 900, y: 0, z: 0 };
  const plant = physics.addMotorJoint(ground.anchor, foot, {
    localFrameA: { position: ground.anchor.body.getLocalPoint(contact) },
    localFrameB: { position: foot.body.getLocalPoint(contact) },
    linearHertz: 18, linearDampingRatio: 1, maxSpringForce: 1000,
    maxSpringTorque: 0, maxVelocityForce: 0, maxVelocityTorque: 0, collideConnected: true,
  });
  try {
    ground.updateSources([{ rig: { entries: [foot] } }]);
    assert.equal(ground.entry.body.getPosition().x, 900);
    assert.deepEqual(plant.a.body.getWorldPoint(plant.options.localFrameA.position), contact);
    for (let i = 0; i < 120; i++) physics.step(1 / 60);
    const p = foot.body.getPosition(), v = foot.body.getLinearVelocity();
    assert.ok(Math.abs(p.x - 900) < .01 && Math.abs(p.z) < .01 && Math.abs(p.y - .5) < .03);
    assert.ok(Math.abs(v.x) < .01 && Math.abs(v.z) < .01);
    ground.dispose();
    assert.equal(physics.joints.length, 0, 'Disposal also releases the stationary foot anchor.');
  } finally { dispose(); }
});

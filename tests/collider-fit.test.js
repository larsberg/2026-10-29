import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Ray, Scene, Vector3 } from 'three';
import { initCSG, createBoxUnion } from '../src/box-union.js';
import { initPhysics, createPhysics } from '../src/physics.js';
import { createMeshView } from '../src/mesh-view.js';
import { defaultMeshSetup, mergeMeshSetup } from '../src/mesh-settings.js';

await initCSG(); await initPhysics();
const setup = mergeMeshSetup(defaultMeshSetup(), { rigidBody: { gravity: 0 },
  pipeline: { initialDiamondDualEnabled: true, hexelateEnabled: true, finalAverageVerticesEnabled: true } });
function fixture(seed, spread) {
  const source = createBoxUnion(seed, spread), physics = createPhysics(setup.rigidBody), view = createMeshView(new Scene(), undefined, physics);
  view.configure(setup); view.setMesh(source.mesh, setup, source);
  return { source, physics, view, dispose() { view.dispose(); physics.dispose(); } };
}

test('rounded isolated pieces receive smaller hulls without the old box corners', () => {
  const { source, view, dispose } = fixture(1, 4);
  try {
    for (const [i, collider] of view.rig.colliders.entries()) {
      assert.ok(collider && view.rig.entries[i].shapes[0].isValid());
      for (const point of collider.points) point.toArray().forEach((value, axis) => {
        assert.ok(Math.abs(value) <= source.boxes[i].size[axis] / 2 + 2e-5);
      });
    }
    for (const i of [0, 1, 6]) {
      const { size } = source.boxes[i], collider = view.rig.colliders[i];
      assert.ok(collider.volume < size.reduce((a, b) => a * b, 1) * .35);
      const body = view.rig.entries[i].body, rotation = new Quaternion().copy(body.getRotation()).normalize();
      const origin = new Vector3(size[0] * .49, size[1] * .49, size[2] + 10).applyQuaternion(rotation).add(new Vector3().copy(body.getPosition()));
      const translation = new Vector3(0, 0, -30).applyQuaternion(rotation);
      assert.equal(view.rig.entries[i].shapes[0].rayCast(origin, translation).hit, false, 'Empty old box corners must no longer be pickable.');
    }
  } finally { dispose(); }
});

test('native hull raycasts match the displayed fitted geometry at moved body poses', () => {
  const { view, physics, dispose } = fixture(450725, 2);
  try {
    const rig = view.rig, body = rig.entries[1].body;
    body.applyAngularImpulse({ x: 0, y: body.getMass(), z: 0 }, true);
    for (let i = 0; i < 15; i++) physics.step(1 / 60);
    for (const [i, collider] of rig.colliders.entries()) {
      const body = rig.entries[i].body, position = new Vector3().copy(body.getPosition());
      const rotation = new Quaternion().copy(body.getRotation()).normalize();
      const center = collider.bounds.getCenter(new Vector3());
      for (const axis of [new Vector3(1,0,0), new Vector3(0,1,0), new Vector3(0,0,1)]) for (const sign of [-1, 1]) {
        const origin = center.clone().addScaledVector(axis, sign * 15), direction = axis.clone().multiplyScalar(-sign);
        const expected = collider.hull.intersectRay(new Ray(origin, direction), new Vector3());
        const hit = rig.entries[i].shapes[0].rayCast(origin.clone().applyQuaternion(rotation).add(position), direction.clone().multiplyScalar(30).applyQuaternion(rotation));
        assert.ok(expected && hit.hit);
        expected.applyQuaternion(rotation).add(position);
        assert.ok(expected.distanceTo(new Vector3().copy(hit.point)) < .005, 'Debug and physics hulls must agree within native hull tolerance.');
      }
    }
  } finally { dispose(); }
});

test('changing smoothing and spread refits the hulls and disposes the previous debug geometry', () => {
  const { source, view, physics, dispose } = fixture(1, 2);
  try {
    const before = view.rig, volume = before.colliders.reduce((sum, collider) => sum + collider.volume, 0);
    let disposed = 0;
    for (const collider of before.colliders) collider.geometry.addEventListener('dispose', () => disposed++);
    const smoother = mergeMeshSetup(setup, { pipeline: { smoothingIterations: 8 } });
    view.regenerate(undefined, smoother);
    assert.equal(disposed, 7); assert.notEqual(view.rig, before);
    assert.ok(view.rig.colliders.reduce((sum, collider) => sum + collider.volume, 0) < volume);
    const spaced = createBoxUnion(source.seed, 4); view.setMesh(spaced.mesh, setup, spaced);
    assert.equal(physics.entries.length, 7); assert.equal(physics.joints.length, 2);
    assert.equal(view.rig.colliders.filter(Boolean).length, 7);
  } finally { dispose(); }
});

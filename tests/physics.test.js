import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Object3D, Quaternion, Vector3 } from 'three';
import { initPhysics, createPhysics } from '../src/physics.js';

await initPhysics();
const cube = { type: 'box', halfExtents: { x: .5, y: .5, z: .5 } };

test('Box3D resolves rigid contacts while an unsupported body falls below the old floor', () => {
  const physics = createPhysics({ gravity: 9.8 });
  try {
    assert.equal(physics.entries.length, 0);
    physics.addBody({ body: { type: 'static', position: { x: 0, y: -.5, z: 0 } }, shapes: [cube] });
    const supported = physics.addBody({ body: { position: { x: 0, y: 2, z: 0 } }, shapes: [cube] });
    const falling = physics.addBody({ body: { position: { x: 3, y: 2, z: 0 } }, shapes: [cube] });
    for (let frame = 0; frame < 120; frame++) physics.step(1 / 60);
    assert.ok(Math.abs(supported.body.getPosition().y - .5) < .03);
    assert.ok(falling.body.getPosition().y < -10);
    physics.reset();
    assert.equal(falling.body.getPosition().y, 2);
    assert.deepEqual(falling.body.getLinearVelocity(), { x: 0, y: 0, z: 0 });
  } finally { physics.dispose(); physics.dispose(); }
});

test('fixed stepping agrees across frame rates and bounds catchup after a stall', () => {
  const worlds = [createPhysics({ gravity: 9.8 }), createPhysics({ gravity: 9.8 })];
  try {
    const entries = worlds.map(physics => physics.addBody({ shapes: [cube] }));
    for (let i = 0; i < 60; i++) worlds[0].step(1 / 60);
    for (let i = 0; i < 30; i++) worlds[1].step(1 / 30);
    assert.deepEqual(entries[0].body.getPosition(), entries[1].body.getPosition());
    worlds.forEach(physics => physics.reset());
    worlds[0].step(10); worlds[1].step(8 / 120);
    assert.deepEqual(entries[0].body.getPosition(), entries[1].body.getPosition());
    const before = entries[0].body.getPosition();
    for (const dt of [0, -1, NaN, Infinity]) assert.equal(worlds[0].step(dt), false);
    assert.deepEqual(entries[0].body.getPosition(), before);
  } finally { worlds.forEach(physics => physics.dispose()); }
});

test('mesh bindings preserve world poses inside transformed parents and reset without rebuilding', () => {
  const physics = createPhysics({ gravity: 9.8 }), parent = new Group(), object = new Object3D();
  parent.position.set(3, 4, 5); parent.rotation.set(.2, .5, -.1); parent.scale.setScalar(2);
  object.position.set(1, 2, 3); object.rotation.set(.1, .3, -.2); parent.add(object);
  const start = object.getWorldPosition(new Vector3()), orientation = object.getWorldQuaternion(new Quaternion());
  try {
    const entry = physics.addBody({ object, shapes: [cube] });
    for (let i = 0; i < 30; i++) physics.step(1 / 60);
    assert.ok(object.getWorldPosition(new Vector3()).distanceTo(new Vector3().copy(entry.body.getPosition())) < 1e-5);
    physics.configure({ gravity: 0, friction: 1.2 }); physics.reset();
    physics.step(1 / 60);
    assert.ok(object.getWorldPosition(new Vector3()).distanceTo(start) < 1e-5);
    assert.ok(object.getWorldQuaternion(new Quaternion()).angleTo(orientation) < 1e-4);
    assert.equal(physics.entries[0], entry);
    assert.throws(() => physics.configure({ gravity: -1 }), /gravity/);
    assert.throws(() => physics.addBody({ shapes: [{ type: 'unknown' }] }), /collider/);
    assert.equal(physics.entries.length, 1);
  } finally { physics.dispose(); }
});

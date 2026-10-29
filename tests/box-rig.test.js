import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Raycaster, Scene, Vector3 } from 'three';
import { initCSG, createBoxUnion } from '../src/box-union.js';
import { initPhysics, createPhysics } from '../src/physics.js';
import { createMeshView } from '../src/mesh-view.js';
import { defaultMeshSetup, mergeMeshSetup } from '../src/mesh-settings.js';
import { boxConnections } from '../src/box-rig.js';

await initCSG(); await initPhysics();
const source = createBoxUnion(1);
const setup = mergeMeshSetup(defaultMeshSetup(), {
  rigidBody: { gravity: 0 },
  pipeline: { initialDiamondDualEnabled: true, hexelateEnabled: true, finalAverageVerticesEnabled: true },
});
const maximumDifference = (a, b) => Math.max(...a.map((value, i) => Math.abs(value - b[i])));
function signedDistance(point, box) {
  const local = point.clone().sub(new Vector3(...box.position)).applyQuaternion(new Quaternion(...box.quaternion).invert());
  const q = local.toArray().map((value, axis) => Math.abs(value) - box.size[axis] / 2);
  return Math.hypot(...q.map(value => Math.max(0, value))) + Math.min(Math.max(...q), 0);
}
function fixture() {
  const physics = createPhysics(setup.rigidBody), view = createMeshView(new Scene(), undefined, physics);
  view.configure(setup); view.setMesh(source.mesh, setup, source);
  return { physics, view, dispose() { view.dispose(); physics.dispose(); } };
}

test('source box frames reproduce the CSG boundary and joint anchors lie inside both connected boxes', () => {
  for (const vertex of source.mesh.vertices) {
    const distance = Math.min(...source.boxes.map(box => signedDistance(new Vector3(...vertex), box)));
    assert.ok(Math.abs(distance) < 2e-5, `Collider and CSG boundary differ by ${distance}`);
  }
  const connections = boxConnections(source), connected = new Set([0]);
  assert.equal(connections.length, 6);
  for (let pass = 0; pass < 7; pass++) for (const edge of connections) {
    if (connected.has(edge.a) || connected.has(edge.b)) { connected.add(edge.a); connected.add(edge.b); }
    for (const id of [edge.a, edge.b]) assert.ok(signedDistance(new Vector3(...edge.anchor), source.boxes[id]) <= 1e-6);
  }
  assert.equal(connected.size, 7);
});

test('separated boxes have no joints and move independently of the overlapping clusters', () => {
  const separated = createBoxUnion(1, 4), physics = createPhysics({ gravity: 0 });
  const view = createMeshView(new Scene(), undefined, physics);
  try {
    view.configure(setup); view.setMesh(separated.mesh, setup, separated);
    const rig = view.rig;
    // This layout has two overlapping pairs and three isolated boxes.
    assert.deepEqual(rig.connections.map(({ a, b }) => [a, b]).sort(), [[2, 4], [3, 5]]);
    assert.equal(physics.joints.length, 2);
    for (const connection of rig.connections) assert.ok(separated.overlaps.includes(connection));
    const rest = rig.entries.map(({ body }) => new Vector3().copy(body.getPosition()));
    const restMesh = rig.positions.slice();
    for (const influences of rig.weights) {
      if (influences[0][0] === 0) assert.deepEqual(influences, [[0, 1]], 'An isolated piece belongs entirely to its own bone.');
    }
    const isolated = rig.entries[0].body;
    isolated.applyLinearImpulseToCenter({ x: isolated.getMass() * 2, y: 0, z: 0 }, true);
    for (let i = 0; i < 30; i++) physics.step(1 / 60);
    assert.ok(new Vector3().copy(isolated.getPosition()).distanceTo(rest[0]) > .5);
    for (let i = 1; i < 7; i++) assert.ok(new Vector3().copy(rig.entries[i].body.getPosition()).distanceTo(rest[i]) < 1e-4);
    for (const [i, influences] of rig.weights.entries()) if (influences[0][0] !== 0) {
      assert.ok(maximumDifference(rig.positions.slice(i * 3, i * 3 + 3), restMesh.slice(i * 3, i * 3 + 3)) < 1e-4,
        'Moving a detached piece must not pull the skin of another cluster.');
    }
    view.setMesh(source.mesh, setup, source);
    assert.equal(physics.joints.length, 6, 'Bringing boxes back together rebuilds their overlap connections.');
    view.setMesh(separated.mesh, setup, separated);
    assert.equal(physics.joints.length, 2, 'Spreading them apart removes the former connections.');
    assert.deepEqual(boxConnections({ boxes: separated.boxes, overlaps: [] }), []);
  } finally { view.dispose(); physics.dispose(); }
});

test('a detached hull makes contact with a connected cluster and transfers motion', () => {
  const separated = createBoxUnion(1, 4), physics = createPhysics(setup.rigidBody);
  const view = createMeshView(new Scene(), undefined, physics);
  try {
    view.configure(setup); view.setMesh(separated.mesh, setup, separated);
    const rig = view.rig, moving = rig.entries[0].body;
    const tags = new Map(rig.entries.flatMap((entry, i) => entry.shapes.map(shape => {
      shape.enableContactEvents(true); return [shape.getUserData(), i];
    })));
    const target = new Vector3().copy(rig.entries[2].body.getWorldPoint(rig.colliders[2].bounds.getCenter(new Vector3())));
    const offset = rig.colliders[0].bounds.getCenter(new Vector3()).applyQuaternion(new Quaternion().copy(moving.getRotation()));
    moving.setTransform(target.clone().add(new Vector3(0, 0, 6)).sub(offset), moving.getRotation());
    moving.setLinearDamping(0); moving.setLinearVelocity({ x: 0, y: 0, z: -12 });
    const rest = new Vector3().copy(rig.entries[2].body.getPosition()), contacts = [];
    for (let step = 0; step < 120; step++) {
      physics.step(1 / 120);
      for (const event of physics.world.getContactEvents().begin) {
        contacts.push([tags.get(event.shapeUserDataA), tags.get(event.shapeUserDataB)]);
      }
    }
    assert.ok(contacts.some(pair => pair.includes(0) && pair.includes(2)), 'The detached hull must hit the larger cluster.');
    for (const [a, b] of contacts) assert.notEqual(rig.components[a], rig.components[b], 'Overlapping hulls in one cluster must not fight their joints.');
    assert.ok(rest.distanceTo(new Vector3().copy(rig.entries[2].body.getPosition())) > .5, 'Contact must push the cluster.');
    assert.ok(moving.getLinearVelocity().z > -10, 'Contact must slow the detached piece.');
    assert.equal(physics.joints.length, 2, 'Touching pieces must not acquire new joints.');
    assert.ok(rig.positions.every(Number.isFinite));
  } finally { view.dispose(); physics.dispose(); }
});

test('the processed surface binds without moving and floats without internal collision impulses', () => {
  const { physics, view, dispose } = fixture();
  try {
    const rig = view.rig, rest = rig.positions.slice();
    assert.equal(rig.skin.isSkinnedMesh, true);
    assert.equal(rig.bones.length, 7); assert.equal(physics.entries.length, 7); assert.equal(physics.joints.length, 6);
    assert.ok(maximumDifference(rest, view.topology.vertices.flat()) < 1e-6);
    for (const influences of rig.weights) {
      assert.equal(influences.length, 4);
      assert.ok(Math.abs(influences.reduce((sum, [, weight]) => sum + weight, 0) - 1) < 1e-7);
      for (const [id, weight] of influences) assert.ok(id >= 0 && id < 7 && weight >= 0 && Number.isFinite(weight));
    }
    for (let i = 0; i < 300; i++) physics.step(1 / 60);
    assert.ok(maximumDifference(rig.positions, rest) < 1e-4);
    assert.equal(new Vector3().copy(physics.world.getGravity()).length(), 0);
  } finally { dispose(); }
});

test('box impulses deform the skin and wireframe together, preserve joints, and reset the bind pose', () => {
  const { physics, view, dispose } = fixture();
  try {
    const rig = view.rig, rest = rig.positions.slice(), body = rig.entries[0].body;
    body.applyAngularImpulse({ x: 0, y: body.getMass() * 3, z: 0 }, true);
    for (let i = 0; i < 30; i++) physics.step(1 / 60);
    assert.ok(maximumDifference(rig.positions, rest) > .01);
    const actual = new Vector3(), expected = new Vector3();
    for (const { a, b, options } of rig.joints) {
      actual.copy(a.body.getWorldPoint(options.localFrameA.position));
      expected.copy(b.body.getWorldPoint(options.localFrameB.position));
      assert.ok(actual.distanceTo(expected) < .005);
    }
    for (const [i, id] of view.surface.corners.entries()) {
      actual.fromBufferAttribute(rig.skin.geometry.attributes.position, i); rig.skin.applyBoneTransform(i, actual);
      expected.fromArray(rig.positions, id * 3);
      assert.ok(actual.distanceTo(expected) < 2e-6, 'GPU skin inputs must match the shared deformed polygon vertices.');
    }
    for (const [i, edge] of view.edges.entries()) for (const [end, id] of edge.entries()) {
      actual.fromBufferAttribute(view.object.geometry.attributes.position, i * 2 + end);
      expected.fromArray(rig.positions, id * 3); assert.ok(actual.distanceTo(expected) < 1e-7);
    }
    for (const { body, object } of rig.entries) {
      assert.ok(object.getWorldPosition(actual).distanceTo(expected.copy(body.getPosition())) < 1e-6);
      assert.ok(object.getWorldQuaternion(new Quaternion()).angleTo(new Quaternion().copy(body.getRotation()).normalize()) < 1e-6);
    }
    physics.reset(); assert.ok(maximumDifference(rig.positions, rest) < 1e-6);
    for (const { body } of rig.entries) assert.deepEqual(body.getLinearVelocity(), { x: 0, y: 0, z: 0 });
  } finally { dispose(); }
});

test('collider outlines follow body poses and remain visible with the surface and wireframe hidden', () => {
  const { physics, view, dispose } = fixture();
  try {
    const rig = view.rig, debug = mergeMeshSetup(setup, { visibility: { surface: false, wireframe: false, colliders: true } });
    view.configure(debug);
    assert.equal(view.rig, rig); assert.equal(view.object.visible, true); assert.equal(rig.skin.visible, false);
    assert.equal(rig.colliderGroup.visible, true); assert.equal(rig.colliderLines.length, 7);
    const body = rig.entries[0].body;
    body.applyAngularImpulse({ x: body.getMass(), y: 0, z: 0 }, true);
    for (let i = 0; i < 20; i++) physics.step(1 / 60);
    for (const [i, line] of rig.colliderLines.entries()) {
      assert.ok(line.getWorldPosition(new Vector3()).distanceTo(new Vector3().copy(rig.entries[i].body.getPosition())) < 1e-6);
      assert.ok(line.getWorldQuaternion(new Quaternion()).angleTo(new Quaternion().copy(rig.entries[i].body.getRotation()).normalize()) < 1e-6);
      assert.ok(line.getWorldScale(new Vector3()).distanceTo(new Vector3(1, 1, 1)) < 1e-6);
      line.geometry.computeBoundingBox();
      assert.ok(line.geometry.boundingBox.min.distanceTo(rig.colliders[i].bounds.min) < 1e-6);
      assert.ok(line.geometry.boundingBox.max.distanceTo(rig.colliders[i].bounds.max) < 1e-6);
      assert.equal(line.layers.isEnabled(1), false, 'Collider guides must stay out of AO.');
    }
    view.configure(mergeMeshSetup(debug, { visibility: { colliders: false } }));
    assert.equal(rig.colliderGroup.visible, false); assert.equal(view.object.visible, false);
    assert.equal(physics.entries.length, 7); assert.equal(physics.joints.length, 6);
    view.clear(); assert.equal(rig.colliderGroup.parent, null);
  } finally { dispose(); }
});

test('editing, undo, seed regeneration, clearing a binding, and disposal replace rig resources without accumulating bodies', () => {
  const { physics, view, dispose } = fixture();
  try {
    for (const action of [() => view.smooth({ iterations: 1, strength: .3 }), () => view.undo(), () => view.regenerate(undefined, setup)]) {
      const old = view.rig; action(); assert.notEqual(view.rig, old);
      assert.equal(physics.entries.length, 7); assert.equal(physics.joints.length, 6);
    }
    const next = createBoxUnion(42); view.setMesh(next.mesh, defaultMeshSetup(), next);
    assert.equal(physics.entries.length, 7); assert.equal(physics.joints.length, 6);
    view.setMesh(source.mesh, defaultMeshSetup());
    assert.equal(view.rig, undefined); assert.equal(view.surface.mesh.isSkinnedMesh, undefined);
    assert.equal(physics.entries.length, 0); assert.equal(physics.joints.length, 0);
    view.setMesh(source.mesh, setup, source); view.clear();
    assert.equal(physics.entries.length, 0); assert.equal(physics.joints.length, 0);
  } finally { dispose(); }
});

test('grabbing a source box pulls its picked point through the solver and releases all temporary resources', () => {
  const { physics, view, dispose } = fixture();
  try {
    const rig = view.rig, rest = rig.positions.slice();
    const hit = rig.pickCollider(new Raycaster(new Vector3(0, 0, 20), new Vector3(0, 0, -1)));
    assert.ok(hit && rig.entries.includes(hit.link));
    assert.equal(rig.pickCollider(new Raycaster(new Vector3(50, 50, 20), new Vector3(0, 0, -1))), null);
    const local = hit.link.body.getLocalPoint(hit.point), target = hit.point.clone().add(new Vector3(2, 1, 0));
    assert.equal(rig.beginDrag(hit.link, hit.point), true); rig.moveDrag(target);
    assert.equal(rig.dragging, true); assert.equal(physics.entries.length, 8); assert.equal(physics.joints.length, 7);
    for (let i = 0; i < 90; i++) physics.step(1 / 60);
    assert.ok(new Vector3().copy(hit.link.body.getWorldPoint(local)).distanceTo(target) < .03);
    assert.ok(maximumDifference(rig.positions, rest) > .5);
    assert.ok(rig.positions.every(Number.isFinite));
    for (const { a, b, options } of rig.joints) {
      const gap = new Vector3().copy(a.body.getWorldPoint(options.localFrameA.position))
        .distanceTo(new Vector3().copy(b.body.getWorldPoint(options.localFrameB.position)));
      assert.ok(gap < .01, 'The original six joints must hold while dragging.');
    }
    rig.endDrag(); rig.endDrag();
    assert.equal(rig.dragging, false); assert.equal(physics.entries.length, 7); assert.equal(physics.joints.length, 6);
    const afterRelease = rig.positions.slice(); physics.step(1 / 60);
    assert.ok(maximumDifference(rig.positions, afterRelease) > 0, 'Release preserves physical motion.');
    const movedHit = rig.pickCollider(new Raycaster(new Vector3().copy(hit.link.body.getPosition()).add(new Vector3(0, 0, 20)), new Vector3(0, 0, -1)));
    assert.ok(movedHit); rig.beginDrag(movedHit.link, movedHit.point);
    view.regenerate(undefined, setup);
    assert.equal(rig.dragging, false); assert.equal(physics.entries.length, 7); assert.equal(physics.joints.length, 6);
    assert.equal(rig.pickCollider(new Raycaster()), null);
  } finally { dispose(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Raycaster, Scene, Vector3 } from 'three';
import { createFaceMetal } from '../src/face-metal.js';
import { initCSG, createBoxUnion } from '../src/box-union.js';
import { initPhysics, createPhysics } from '../src/physics.js';
import { createSculptureGroup } from '../src/sculpture-group.js';
import { defaultMeshSetup, mergeMeshSetup } from '../src/mesh-settings.js';

await initCSG(); await initPhysics();
const source = createBoxUnion(450725, 2);
const setup = mergeMeshSetup(defaultMeshSetup(), { rigidBody: { gravity: 0 },
  pipeline: { initialDiamondDualEnabled: true, hexelateEnabled: true, finalAverageVerticesEnabled: true } });
function fixture() {
  const physics = createPhysics(setup.rigidBody), material = createFaceMetal();
  const group = createSculptureGroup(new Scene(), material, physics);
  group.configure(setup); group.setMesh(source.mesh, setup, source);
  return { physics, material, group, dispose() { group.dispose(); material.dispose(); physics.dispose(); } };
}

test('three copies spawn apart with independent skin uniforms and shared material controls', () => {
  const { group, physics, material, dispose } = fixture();
  try {
    assert.equal(physics.entries.length, 21); assert.equal(physics.joints.length, 18);
    const boxes = group.views.map(view => view.getBounds(new Box3()));
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.equal(boxes[i].intersectsBox(boxes[j]), false);
    assert.ok(group.getCenter(new Vector3()).length() < 1e-5);
    material.color.set('#123456'); material.roughness = .61; material.userData.normalMix = .73; group.configure(setup);
    const textures = group.views.map(view => {
      assert.equal(view.surface.mesh.material.color.getHexString(), '123456');
      assert.equal(view.surface.mesh.material.roughness, .61); assert.equal(view.surface.normalMix, .73);
      const shader = { uniforms: {}, vertexShader: '#include <defaultnormal_vertex>', fragmentShader: '#include <normal_fragment_begin>' };
      view.surface.mesh.material.onBeforeCompile(shader, {});
      for (const [i, coordinate] of view.topology.vertices.flat().entries()) assert.ok(Math.abs(view.rig.positions[i] - coordinate) < 1e-5);
      return shader.uniforms.dualCorners.value;
    });
    assert.equal(new Set(textures).size, 3, 'Independent poses must not share the polygon-normal texture.');
    const before = group.views.map(view => view.rig.positions.slice());
    for (let i = 0; i < 120; i++) physics.step(1 / 120);
    group.views.forEach((view, i) => assert.ok(view.rig.positions.every((value, j) => Math.abs(value - before[i][j]) < 1e-4)));
  } finally { dispose(); }
});

test('copies collide with each other and group picking grabs the nearest hull', () => {
  const { group, physics, dispose } = fixture();
  try {
    const [left, right] = group.views, center = right.getCenter(new Vector3()), contacts = [];
    const tags = new Map(group.views.flatMap((view, i) => view.rig.entries.flatMap(entry => entry.shapes.map(shape => {
      shape.enableContactEvents(true); return [shape.getUserData(), i];
    }))));
    const caster = new Raycaster(new Vector3(0, 0, 40), new Vector3(0, 0, -1));
    const hits = group.views.map(view => view.rig.pickCollider(caster)).filter(Boolean).sort((a, b) => a.distance - b.distance);
    const hit = group.rig.pickCollider(caster); assert.ok(hit); assert.equal(hit.link, hits[0].link);
    assert.equal(group.rig.beginDrag(hit.link, hit.point), true); assert.equal(group.rig.dragging, true);
    group.rig.moveDrag(hit.point.clone().add(new Vector3(.2, 0, 0))); physics.step(1 / 60); group.rig.endDrag(); physics.reset();
    for (const { body } of left.rig.entries) { body.setLinearDamping(0); body.setLinearVelocity({ x: 8, y: 0, z: 0 }); }
    for (let step = 0; step < 120; step++) {
      physics.step(1 / 120);
      for (const event of physics.world.getContactEvents().begin) contacts.push([tags.get(event.shapeUserDataA), tags.get(event.shapeUserDataB)]);
    }
    assert.ok(contacts.some(pair => pair.includes(0) && pair.includes(1)), 'The copies must collide instead of passing through each other.');
    assert.ok(right.getCenter(new Vector3()).distanceTo(center) > .1);
    assert.equal(physics.entries.length, 21); assert.equal(physics.joints.length, 18);
    group.views.forEach(view => assert.ok(view.rig.positions.every(Number.isFinite)));
  } finally { dispose(); }
});

test('editing, undo, and regeneration affect all copies without accumulating physics resources', () => {
  const { group, physics, dispose } = fixture();
  try {
    const original = structuredClone(group.topology);
    group.triangulate(undefined, { seed: 17 });
    for (const view of group.views) assert.deepEqual(view.topology, group.topology);
    assert.equal(group.canUndo, true); group.undo();
    for (const view of group.views) assert.deepEqual(view.topology, original);
    group.smooth({ iterations: 1, strength: .3 }); group.undo(); group.setMesh(source.mesh, setup, source);
    assert.equal(physics.entries.length, 21); assert.equal(physics.joints.length, 18);
    group.clear(); assert.equal(physics.entries.length, 0); assert.equal(physics.joints.length, 0);
  } finally { dispose(); }
});

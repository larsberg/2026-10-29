import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Vector3 } from 'three';
import { initCSG, createBoxUnion } from '../src/box-union.js';
import { validatePolygonMesh } from '../src/mesh-operations.js';
import { createMeshView } from '../src/mesh-view.js';
import { defaultMeshSetup, mergeMeshSetup, validateMeshSetup } from '../src/mesh-settings.js';

await initCSG();

function checkClosedSolid(mesh) {
  validatePolygonMesh(mesh);
  const edges = new Map(), neighbors = mesh.vertices.map(() => new Set());
  let volume = 0;
  for (const face of mesh.faces) {
    assert.equal(face.length, 3);
    const [a, b, c] = face.map(id => new Vector3(...mesh.vertices[id]));
    volume += a.dot(b.cross(c)) / 6;
    face.forEach((a, i) => {
      const b = face[(i + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const pair = edges.get(key) ?? []; pair.push([a, b]); edges.set(key, pair);
      neighbors[a].add(b); neighbors[b].add(a);
    });
  }
  for (const pair of edges.values()) {
    assert.equal(pair.length, 2, 'Every edge must have two incident faces.');
    assert.deepEqual(pair[0], [...pair[1]].reverse());
  }
  const seen = new Set([0]), queue = [0];
  while (queue.length) for (const id of neighbors[queue.pop()]) if (!seen.has(id)) { seen.add(id); queue.push(id); }
  assert.equal(seen.size, mesh.vertices.length, 'The union must be one connected component.');
  // Wider spacing can create tunnels; a closed orientable surface need not
  // have the original cluster's sphere topology (Euler characteristic 2).
  const characteristic = mesh.vertices.length - edges.size + mesh.faces.length;
  assert.ok(characteristic <= 2 && characteristic % 2 === 0);
  assert.ok(volume > 0, 'Faces must point outward.');
  return volume;
}

test('five overlapping random boxes form a centered, closed triangle union across seeds', () => {
  for (const seed of [0, 1, 2, 7, 42, 99, 1000000]) {
    const result = createBoxUnion(seed), { mesh, boxes } = result;
    assert.equal(boxes.length, 5);
    const volume = checkClosedSolid(mesh);
    assert.ok(Math.abs(volume - result.volume) < result.volume * 1e-6);
    const volumes = boxes.map(({ size }) => size.reduce((product, x) => product * x, 1));
    assert.ok(volume > Math.max(...volumes), 'Multiple boxes contribute to the exterior.');
    assert.ok(volume < volumes.reduce((a, b) => a + b), 'The union removes overlapping interiors.');
    for (let axis = 0; axis < 3; axis++) {
      const values = mesh.vertices.map(v => v[axis]);
      assert.ok(Math.abs(Math.min(...values) + Math.max(...values)) < 1e-8);
    }
  }
});

test('saving the seed and spread reproduces the same box geometry', () => {
  const setup = mergeMeshSetup(defaultMeshSetup(), { pipeline: { seed: 38 }, boxes: { spread: 3 } });
  const saved = validateMeshSetup(JSON.parse(JSON.stringify(setup)));
  assert.deepEqual(createBoxUnion(saved.pipeline.seed, saved.boxes.spread), createBoxUnion(38, 3));
  assert.notDeepEqual(createBoxUnion(39).mesh, createBoxUnion(38).mesh);
  assert.throws(() => createBoxUnion(-1), /seed/);
});

test('spread changes source center spacing without changing box sizes or rotations', () => {
  const original = createBoxUnion(1, 1);
  for (const spread of [0, .5, 2, 4]) {
    const next = createBoxUnion(1, spread);
    for (let i = 0; i < 5; i++) {
      assert.deepEqual(next.boxes[i].size, original.boxes[i].size);
      assert.deepEqual(next.boxes[i].quaternion, original.boxes[i].quaternion);
      // Union recentering moves the common origin; pairwise offsets still scale exactly.
      const before = new Vector3(...original.boxes[i].position).sub(new Vector3(...original.boxes[0].position)).multiplyScalar(spread);
      const after = new Vector3(...next.boxes[i].position).sub(new Vector3(...next.boxes[0].position));
      assert.ok(before.distanceTo(after) < 1e-8);
    }
    validatePolygonMesh(next.mesh);
  }
  for (const spread of [-1, 4.1, NaN, Infinity, '2']) assert.throws(() => createBoxUnion(1, spread), /spread/);
});

test('the union uses the existing view, triangle wireframe, mesh operations and undo', () => {
  const view = createMeshView(new Scene()), setup = defaultMeshSetup(), { mesh } = createBoxUnion(1);
  try {
    view.configure(setup); view.setMesh(mesh, setup);
    assert.deepEqual(view.topology, mesh);
    assert.equal(view.surface.mesh.geometry.index.count, mesh.faces.length * 3);
    assert.equal(view.edges.length, mesh.faces.length * 3 / 2);
    view.dualDiamond(); view.triangulate(); checkClosedSolid(view.topology);
    assert.ok(view.canUndo); view.undo(); view.undo(); assert.deepEqual(view.topology, mesh);
    view.regenerate(undefined, savedSetup(setup));
    assert.deepEqual(view.topology, mesh); assert.equal(view.canUndo, false);
  } finally { view.dispose(); }
});

const savedSetup = setup => validateMeshSetup(JSON.parse(JSON.stringify(setup)));

import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { createMeshLayers, createSeededRandom } from '../src/mesh-layers.js';
import { defaultMeshSetup, mergeMeshSetup } from '../src/mesh-settings.js';
import { applyCameraView } from '../src/camera.js';
import { averageVertices, dualDiamond, dualNSided, faceFrame, triangulateFace, triangulateFaces } from '../src/mesh-operations.js';
import { createViewportMesh, polygonEdges } from '../src/polygon-mesh.js';
import { createMeshView } from '../src/mesh-view.js';

function checkGrid(mesh, width, height) {
  const edges = new Map();
  for (const face of mesh.faces) {
    assert.ok(faceFrame(mesh, face).normal.z > .999999);
    assert.equal(triangulateFace(mesh, face).length, face.length - 2);
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length], key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const list = edges.get(key) ?? []; list.push([a, b]); edges.set(key, list);
    });
  }
  let perimeter = 0;
  for (const list of edges.values()) {
    assert.ok(list.length <= 2);
    if (list.length === 2) { assert.deepEqual(list[0], [...list[1]].reverse()); continue; }
    const [a, b] = list[0].map(id => mesh.vertices[id]);
    assert.ok([[0, -width/2], [0, width/2], [1, -height/2], [1, height/2]].some(([axis, value]) => Math.abs(a[axis]-value)<1e-10 && Math.abs(b[axis]-value)<1e-10));
    perimeter += new Vector3(...a).distanceTo(new Vector3(...b));
  }
  assert.ok(Math.abs(perimeter - 2*(width+height)) < 1e-9);
  assert.equal(mesh.vertices.length - edges.size + mesh.faces.length, 1);
  for (const [x, y, z] of mesh.vertices) {
    assert.equal(z, 0); assert.ok(Math.abs(x) <= width/2 + 1e-10); assert.ok(Math.abs(y) <= height/2 + 1e-10);
  }
}

test('the default camera frames a centered shared-vertex test grid', () => {
  const mesh = createViewportMesh(8, 6, 9), setup = defaultMeshSetup();
  assert.equal(mesh.vertices.length, 130); assert.equal(mesh.faces.length, 108);
  assert.equal(new Set(mesh.vertices.map(point => JSON.stringify(point))).size, 130);
  const camera = new PerspectiveCamera(), controls = { target: new Vector3(), update() {} };
  applyCameraView(setup.camera, camera, controls, new Vector3());
  assert.ok(Math.abs(camera.position.length() - 62) < 1e-10);
  assert.ok(camera.position.y > 0, 'The opening camera looks at the herd from above the ground.');
  checkGrid(mesh, 8, 6);
});

test('the three mesh operations run in order and Hexelate produces a majority of hexagons', () => {
  const base = createViewportMesh(8, 6, 9), before = structuredClone(base), setup = mergeMeshSetup(defaultMeshSetup(), {pipeline:{initialDiamondDualEnabled:true,hexelateEnabled:true,finalAverageVerticesEnabled:true}});
  const triangles = triangulateFaces(base, undefined, { random: createSeededRandom(setup.pipeline.seed) }).mesh;
  const diamonds = dualDiamond(triangles).mesh;
  const hexagons = dualNSided(triangulateFaces(diamonds, undefined, { shortestDiagonal: true }).mesh).mesh;
  const result = createMeshLayers(base, setup.pipeline);
  assert.deepEqual(result.stages.map(stage => stage.name), ['Random triangulate','Dialate · diamond dual · keep boundary','Hexelate · face-center dual','Smooth mesh · fixed boundary']);
  assert.deepEqual(result.mesh, averageVertices(hexagons, undefined, {iterations:setup.pipeline.smoothingIterations,strength:setup.pipeline.smoothingStrength}).mesh); assert.deepEqual(base, before);
  assert.ok(result.mesh.faces.filter(face => face.length === 6).length / result.mesh.faces.length > .6);
  for (const mesh of [base, triangles, diamonds, hexagons]) checkGrid(mesh, 8, 6);
  const oldEdges = new Set(polygonEdges(base.faces).map(edge => [...edge].sort((a,b)=>a-b).join(':')));
  assert.equal(polygonEdges(triangles.faces).filter(edge => !oldEdges.has([...edge].sort((a,b)=>a-b).join(':'))).length, base.faces.length);
});

test('every primary operation combination stays flat and keeps the grid boundary across seeds and sizes', () => {
  for (const dimensions of [[8,6,9], [3,8,3], [10,3,3], [1,1,1]]) {
    const base = createViewportMesh(...dimensions);
    for (const seed of [0,1,42,1000000]) for (let mask = 0; mask < 8; mask++) {
      const options = { ...defaultMeshSetup().pipeline, seed, triangulateEnabled: !!(mask&1), initialDiamondDualEnabled: !!(mask&2), hexelateEnabled: !!(mask&4) };
      const first = createMeshLayers(base, options);
      checkGrid(first.mesh, base.width, base.height);
      assert.deepEqual(first, createMeshLayers(base, options));
    }
  }
});

test('manual mesh operations undo as a single edit and resetting restores the saved pipeline', () => {
  const setup = defaultMeshSetup(), view = createMeshView(new Scene());
  view.configure(setup); view.setMesh(createViewportMesh(8, 6, 9), setup);
  const original = structuredClone(view.topology);
  view.hexelate(); assert.equal(view.canUndo, true); view.undo(); assert.deepEqual(view.topology, original);
  const plain = mergeMeshSetup(setup, {pipeline:{enabled:false}});
  view.setMesh(createViewportMesh(8, 6, 9), plain); view.dualDiamond(); view.undo(); assert.equal(view.topology.faces.length, 108);
  view.triangulate([0], {random:createSeededRandom(1)}); assert.equal(view.topology.faces.length, 109);
  view.setMesh(createViewportMesh(8, 6, 9), setup); assert.deepEqual(view.topology, original); assert.equal(view.canUndo, false);
  view.dispose();
});

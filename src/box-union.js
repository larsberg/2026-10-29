import ManifoldModule from 'manifold-3d';
import { createSeededRandom } from './mesh-layers.js';
import { triangulateFaces } from './mesh-operations.js';
import { Euler, Quaternion, Vector3 } from 'three';
import { validateBoxSpread } from './box-settings.js';

export const BOX_COUNT = 5;
let engine, initialization;

export function initCSG(options) {
  return initialization ??= ManifoldModule(options).then(module => {
    module.setup(); engine = module;
  });
}

export function createBoxDefinitions(seed, spread) {
  spread = validateBoxSpread(spread);
  const random = createSeededRandom(seed);
  return Array.from({ length: BOX_COUNT }, () => {
    const size = Array.from({ length: 3 }, () => 2 + random() * 2.8);
    // Spread scales center offsets while preserving the seeded sizes/rotations.
    const offset = size.map(length => (random() - .5) * length * .72 * spread);
    const rotation = Array.from({ length: 3 }, () => (random() - .5) * 120);
    return { size, offset, rotation };
  });
}

function polygonMesh(source) {
  // CSG may duplicate vertices for per-face properties. Follow its exact seam
  // mapping so the existing half-edge operations see shared topology.
  const parent = Array.from({ length: source.vertProperties.length / source.numProp }, (_, i) => i);
  const root = id => {
    while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; }
    return id;
  };
  for (let i = 0; i < source.mergeFromVert.length; i++) parent[root(source.mergeFromVert[i])] = root(source.mergeToVert[i]);
  const vertices = [], faces = [], indices = new Map();
  for (let i = 0; i < source.triVerts.length; i += 3) {
    faces.push(Array.from(source.triVerts.subarray(i, i + 3), id => {
      id = root(id);
      if (!indices.has(id)) {
        indices.set(id, vertices.length);
        vertices.push(Array.from(source.vertProperties.subarray(id * source.numProp, id * source.numProp + 3)));
      }
      return indices.get(id);
    }));
  }
  const center = [0, 1, 2].map(axis => (Math.min(...vertices.map(v => v[axis])) + Math.max(...vertices.map(v => v[axis]))) / 2);
  for (const vertex of vertices) for (let axis = 0; axis < 3; axis++) vertex[axis] -= center[axis];
  return { mesh: { vertices, faces, kind: 'box-union' }, center };
}

export function createBoxUnion(seed = 1, spread) {
  if (!engine) throw new Error('Initialize CSG before generating boxes.');
  spread = validateBoxSpread(spread);
  const boxes = createBoxDefinitions(seed, spread), handles = [];
  const keep = value => { handles.push(value); return value; };
  try {
    const solids = boxes.map(({ size, offset, rotation }) => {
      const cube = keep(engine.Manifold.cube(size, true));
      const translated = keep(cube.translate(offset));
      return keep(translated.rotate(rotation));
    });
    const union = keep(engine.Manifold.union(solids));
    if (union.isEmpty()) throw new Error('The box union is empty.');
    const { mesh: polygon, center } = polygonMesh(union.getMesh());
    const mesh = triangulateFaces(polygon).mesh;
    // Manifold uses global X, then Y, then Z rotations (Three's ZYX order).
    // Preserve that pose and the centering translation for colliders and bones.
    for (const box of boxes) {
      const quaternion = new Quaternion().setFromEuler(new Euler(...box.rotation.map(value => value * Math.PI / 180), 'ZYX'));
      box.quaternion = quaternion.toArray();
      box.position = new Vector3(...box.offset).applyQuaternion(quaternion).sub(new Vector3(...center)).toArray();
    }
    const overlaps = [];
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const intersection = solids[a].intersect(solids[b]);
      try {
        const volume = intersection.volume();
        if (volume <= 1e-6) continue;
        // The mean of a convex intersection's vertices lies inside both boxes.
        const source = intersection.getMesh(), anchor = [0, 0, 0];
        const count = source.vertProperties.length / source.numProp;
        for (let i = 0; i < count; i++) for (let axis = 0; axis < 3; axis++) anchor[axis] += source.vertProperties[i * source.numProp + axis] / count;
        overlaps.push({ a, b, anchor: anchor.map((value, axis) => value - center[axis]), volume });
      } finally { intersection.delete(); }
    }
    return { mesh, boxes, overlaps, seed, spread, volume: union.volume() };
  } finally {
    for (const handle of handles.reverse()) handle.delete();
  }
}

// Use the finished solid inside each source box as that bone's collision
// region. Clipping the volume also handles boxes buried inside the union,
// which may have no exterior vertices assigned to them by skin weights.
export function createBoxMeshRegions(topology, boxes) {
  if (!engine) throw new Error('Initialize CSG before fitting colliders.');
  const triangles = triangulateFaces(topology).mesh;
  const solid = engine.Manifold.ofMesh(new engine.Mesh({ numProp: 3,
    vertProperties: new Float32Array(triangles.vertices.flat()), triVerts: new Uint32Array(triangles.faces.flat()) }));
  try {
    return boxes.map(box => {
      const handles = [], keep = value => { handles.push(value); return value; };
      try {
        const cube = keep(engine.Manifold.cube(box.size, true));
        const rotated = keep(cube.rotate(box.rotation));
        const region = keep(rotated.translate(box.position));
        const clipped = keep(solid.intersect(region));
        if (clipped.isEmpty() || clipped.volume() < 1e-8) return null;
        const convex = keep(clipped.hull()), mesh = convex.getMesh();
        const center = new Vector3(...box.position), inverse = new Quaternion(...box.quaternion).invert();
        const points = [];
        for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) {
          points.push(new Vector3().fromArray(mesh.vertProperties, i).sub(center).applyQuaternion(inverse));
        }
        return points;
      } finally { handles.reverse().forEach(handle => handle.delete()); }
    });
  } finally { solid.delete(); }
}

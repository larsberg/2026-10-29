import { Box3, BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { createBoxMeshRegions } from './box-union.js';

// Use a modest hull budget for mobile collision work. Thirteen vertices also
// stay below Box3D 0.2's 255-half-edge limit (6V - 12 for triangular faces).
export const MAX_COLLIDER_VERTICES = 13;

// Keep all axis extremes, then distribute the remaining samples over the
// region. The hull stays inside the full convex region, never expanding back
// out to the old box corners. Physics and debug rendering use the same points.
function limitPoints(points, limit) {
  const unique = [...new Map(points.map(point => {
    point.set(Math.fround(point.x), Math.fround(point.y), Math.fround(point.z));
    return [point.toArray().join(','), point];
  })).values()];
  if (unique.length <= limit) return unique;
  const chosen = new Set();
  for (const axis of ['x', 'y', 'z']) for (const sign of [-1, 1]) {
    let best = 0;
    for (let i = 1; i < unique.length; i++) if (sign * unique[i][axis] > sign * unique[best][axis]) best = i;
    chosen.add(best);
  }
  const distances = unique.map(point => Math.min(...[...chosen].map(i => point.distanceToSquared(unique[i]))));
  while (chosen.size < limit) {
    let best = -1;
    for (let i = 0; i < unique.length; i++) if (!chosen.has(i) && (best < 0 || distances[i] > distances[best])) best = i;
    chosen.add(best);
    for (let i = 0; i < unique.length; i++) distances[i] = Math.min(distances[i], unique[i].distanceToSquared(unique[best]));
  }
  return [...chosen].map(i => unique[i]);
}

export function fitBoxColliders(topology, boxes) {
  return createBoxMeshRegions(topology, boxes).map(region => {
    if (!region) return null;
    const points = limitPoints(region, MAX_COLLIDER_VERTICES);
    const hull = new ConvexHull().setFromPoints(points), triangles = [];
    let volume = 0;
    const cross = new Vector3();
    for (const face of hull.faces) {
      const a = face.edge.head().point, b = face.edge.next.head().point, c = face.edge.next.next.head().point;
      triangles.push(...a.toArray(), ...b.toArray(), ...c.toArray());
      volume += a.dot(cross.crossVectors(b, c)) / 6;
    }
    if (!(volume > 1e-8)) return null;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(triangles, 3));
    return { points, hull, geometry, volume, bounds: new Box3().setFromPoints(points) };
  });
}
